import { EventEmitter } from "events";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
  type Tool,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import fs from "fs/promises";
import path from "path";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

function getDefaultModelId(): string {
  const region = process.env.AWS_REGION || '';
  let prefix = 'us'; // default
  if (region.startsWith('ap-')) prefix = 'apac';
  else if (region.startsWith('eu-')) prefix = 'eu';
  return `${prefix}.anthropic.claude-sonnet-4-20250514-v1:0`;
}
const MODEL_ID = process.env.BEDROCK_MODEL_ID || getDefaultModelId();
const MAX_ITERATIONS = 25; // safety limit to prevent infinite loops
const TOKEN_THRESHOLD = 150_000;  // ~150K tokens — trigger summarization

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

function buildSystemPrompt(repoMap?: string): string {
  const basePrompt = `You are a friendly AI coding assistant helping a hackathon participant build a React web app.

Live Preview:
- A Vite dev server is ALREADY running on port 3000 with hot module replacement (HMR). Do NOT start another dev server or run "npm run dev" / "npx vite". Your file changes are automatically reflected in the live preview.
- If the preview seems stuck, use the restart_preview tool or ask the user to refresh.

Key rules:
- You can only read and modify files within the project directory.
- Always explain what you are doing in clear terms before and after making changes.
- Keep code simple and approachable. Avoid overly clever patterns.
- After making changes to code, remind the user to check the live preview to see the results.
- When creating new files, also make sure they are properly imported where needed.
- If something goes wrong, explain the error in plain language and suggest a fix.
- You can be slightly more technical in explanations, but still keep things clear and approachable.`;

  if (repoMap) {
    return `${basePrompt}\n\nHere is a map of the current project files for reference:\n<repo-map>\n${repoMap}\n</repo-map>`;
  }

  return basePrompt;
}

// ---------------------------------------------------------------------------
// Convert tool definitions from tools.ts format to Bedrock Converse format
// ---------------------------------------------------------------------------

function bedrockTools(): Tool[] {
  return TOOL_DEFINITIONS.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description,
      inputSchema: {
        json: t.input_schema as Record<string, unknown>,
      },
    },
  }));
}

// ---------------------------------------------------------------------------
// Agent events (for typing reference)
// ---------------------------------------------------------------------------
//
// "agent:thinking"     — { text: string }           model is producing text
// "agent:text"         — { text: string }           final text block from the model
// "agent:tool_call"    — { toolUseId, name, input } model wants to call a tool
// "agent:tool_result"  — { toolUseId, name, result} tool execution finished
// "agent:file_changed" — { path: string }           a file was written or edited
// "agent:error"        — { error: string }          something went wrong
// ---------------------------------------------------------------------------

// Tools that modify files on disk
const FILE_MUTATING_TOOLS = new Set(["write_file", "edit_file"]);

// ---------------------------------------------------------------------------
// AgentLoop class
// ---------------------------------------------------------------------------

export class AgentLoop extends EventEmitter {
  private client: BedrockRuntimeClient;
  private conversationHistory: Message[] = [];
  private repoMap?: string;
  private currentAbortController: AbortController | null = null;
  private retryCount = 0;

  constructor(repoMap?: string) {
    super();
    this.repoMap = repoMap;
    this.client = new BedrockRuntimeClient({});
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Update the repo map used in the system prompt. */
  updateRepoMap(newMap: string): void {
    this.repoMap = newMap;
  }

  /** Clear all conversation history to start a fresh conversation. */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /** Abort the currently running agent loop iteration. */
  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  /**
   * Ensure conversation history doesn't start mid-tool-exchange.
   * Bedrock requires every tool_use to have a matching toolResult in the next
   * user message. After truncation we might slice right between them.
   */
  private sanitizeHistory(): void {
    const h = this.conversationHistory;
    if (h.length === 0) return;

    // If the first message is a user message containing only toolResult blocks,
    // drop it (the assistant tool_use it responds to was truncated).
    while (h.length > 0 && h[0].role === 'user') {
      const blocks = (h[0].content ?? []) as ContentBlock[];
      const allToolResults = blocks.length > 0 && blocks.every((b) => b.toolResult !== undefined);
      if (allToolResults) {
        h.shift();
      } else {
        break;
      }
    }

    // If the last message is an assistant with tool_use blocks (no following toolResult),
    // drop it to avoid the "Expected toolResult" error.
    while (h.length > 0 && h[h.length - 1].role === 'assistant') {
      const blocks = (h[h.length - 1].content ?? []) as ContentBlock[];
      const hasToolUse = blocks.some((b) => b.toolUse !== undefined);
      if (hasToolUse) {
        h.pop();
      } else {
        break;
      }
    }

    // Bedrock requires conversation to start with a user message
    if (h.length > 0 && h[0].role === 'assistant') {
      h.unshift({ role: 'user', content: [{ text: '[Conversation resumed]' }] });
    }
  }

  /** Estimate total tokens in conversation history using ~4 chars/token heuristic. */
  private estimateTokens(): number {
    let chars = 0;
    for (const msg of this.conversationHistory) {
      if (!msg.content) continue;
      for (const block of msg.content as ContentBlock[]) {
        if (block.text) chars += block.text.length;
        if (block.toolUse) {
          chars += (block.toolUse.name?.length || 0);
          chars += JSON.stringify(block.toolUse.input || {}).length;
        }
        if (block.toolResult?.content) {
          for (const c of block.toolResult.content) {
            if ('text' in c && c.text) chars += c.text.length;
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rc = (block as any)?.reasoningContent;
        if (rc?.reasoningText?.text) chars += rc.reasoningText.text.length;
      }
    }
    return Math.ceil(chars / 4);
  }

  /** Extract plain text from a conversation message for summarization. */
  private extractMessageText(msg: Message): string {
    if (!msg.content) return '';
    const parts: string[] = [];
    for (const block of msg.content as ContentBlock[]) {
      if (block.text) parts.push(block.text);
      if (block.toolUse) {
        parts.push(`[Tool: ${block.toolUse.name}]`);
      }
      if (block.toolResult?.content) {
        for (const c of block.toolResult.content) {
          if ('text' in c && c.text) {
            parts.push(c.text.length > 500 ? c.text.slice(0, 500) + '...' : c.text);
          }
        }
      }
    }
    return `${msg.role}: ${parts.join(' ')}`;
  }

  /** Compact conversation history if it exceeds the token threshold. */
  private async compactHistory(): Promise<void> {
    const estimated = this.estimateTokens();
    if (estimated < TOKEN_THRESHOLD) return;

    console.log(`Token estimate: ~${estimated}. Threshold: ${TOKEN_THRESHOLD}. Compacting...`);

    // Take the oldest 60% of messages for summarization
    const splitIndex = Math.max(2, Math.floor(this.conversationHistory.length * 0.6));
    const oldMessages = this.conversationHistory.slice(0, splitIndex);
    const recentMessages = this.conversationHistory.slice(splitIndex);

    // Build text summary of old messages
    const oldText = oldMessages.map((m) => this.extractMessageText(m)).join('\n');

    try {
      const summaryCommand = new ConverseCommand({
        modelId: MODEL_ID,
        messages: [{
          role: 'user',
          content: [{ text: `Summarize this conversation concisely in 2-3 paragraphs. Preserve: key decisions made, files created/modified, current task context, and any unfinished work.\n\n${oldText.slice(0, 50000)}` }],
        }],
        inferenceConfig: { maxTokens: 1024 },
      });

      const summaryResponse = await this.client.send(summaryCommand);
      const summaryText = summaryResponse.output?.message?.content?.[0]?.text || '';

      if (summaryText) {
        this.conversationHistory = [
          { role: 'user', content: [{ text: `[Previous conversation summary]\n${summaryText}` }] },
          { role: 'assistant', content: [{ text: 'Understood. I have the context from our previous conversation and will continue from here.' }] },
          ...recentMessages,
        ];
        this.sanitizeHistory();
        console.log(`History compacted: ${oldMessages.length + recentMessages.length} messages → ${this.conversationHistory.length} messages`);
        return;
      }
    } catch (err) {
      console.warn('Summarization failed, falling back to truncation:', err);
    }

    // Fallback: simple truncation — keep only recent messages
    this.conversationHistory = recentMessages;
    this.sanitizeHistory();
    console.log(`History truncated: kept ${recentMessages.length} most recent messages`);
  }

  async processMessage(userMessage: string): Promise<void> {
    // Append the user message to conversation history
    this.conversationHistory.push({
      role: "user",
      content: [{ text: userMessage }],
    });

    try {
      await this.runLoop();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("agent:error", { error: message });
    }
  }

  // -------------------------------------------------------------------------
  // Core agent loop
  // -------------------------------------------------------------------------

  private async runLoop(): Promise<void> {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Check if conversation is getting too long and compact if needed
      await this.compactHistory();

      const systemPrompt = buildSystemPrompt(this.repoMap);

      this.currentAbortController = new AbortController();

      const command = new ConverseStreamCommand({
        modelId: MODEL_ID,
        system: [{ text: systemPrompt }] as SystemContentBlock[],
        messages: this.conversationHistory,
        toolConfig: {
          tools: bedrockTools(),
        },
      });

      // Collect the streamed response
      let response;
      try {
        response = await this.client.send(command, {
          abortSignal: this.currentAbortController.signal,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          this.currentAbortController = null;
          return;
        }
        // Token limit error — force truncate and retry
        const errMsg = err instanceof Error ? err.message : String(err);
        const errLower = errMsg.toLowerCase();
        if (errLower.includes('too many tokens') || errLower.includes('too long') || errLower.includes('input is too long') || errLower.includes('throttl')) {
          console.warn('Token limit hit, force-truncating history...');
          const keepCount = Math.max(4, Math.floor(this.conversationHistory.length * 0.3));
          this.conversationHistory = this.conversationHistory.slice(-keepCount);
          this.sanitizeHistory();
          // If rate-limited (not just context overflow), wait before retrying
          if (errLower.includes('wait') || errLower.includes('throttl')) {
            const delaySec = 5 * (iteration + 1);
            console.warn(`Rate limited, waiting ${delaySec}s before retry...`);
            await new Promise((r) => setTimeout(r, delaySec * 1000));
          }
          continue;
        }
        // Transient API errors — retry with exponential backoff
        const isTransient = errLower.includes('throttl') || errLower.includes('timeout') ||
          errLower.includes('service unavailable') || errLower.includes('internal server error') ||
          errLower.includes('too many requests') || errLower.includes('rate exceeded');
        if (isTransient && this.retryCount < 3) {
          this.retryCount++;
          const delaySec = 2 ** this.retryCount; // 2s, 4s, 8s
          console.warn(`Transient API error, retry ${this.retryCount}/3 in ${delaySec}s...`);
          await new Promise((r) => setTimeout(r, delaySec * 1000));
          continue;
        }
        throw err;
      }
      this.retryCount = 0;

      const assistantContent: ContentBlock[] = [];
      let stopReason: string | undefined;

      // ---- Parse the streaming response ----
      if (response.stream) {
        let currentText = "";
        let currentToolUseId: string | undefined;
        let currentToolName: string | undefined;
        let currentToolInputJson = "";

        for await (const event of response.stream as AsyncIterable<ConverseStreamOutput>) {
          // -- Text delta --
          if (event.contentBlockDelta?.delta?.text) {
            const chunk = event.contentBlockDelta.delta.text;
            currentText += chunk;
            this.emit("agent:thinking", { text: chunk });
          }

          // -- Tool use start --
          if (event.contentBlockStart?.start?.toolUse) {
            const toolStart = event.contentBlockStart.start.toolUse;
            currentToolUseId = toolStart.toolUseId;
            currentToolName = toolStart.name;
            currentToolInputJson = "";
          }

          // -- Tool input delta --
          if (event.contentBlockDelta?.delta?.toolUse) {
            currentToolInputJson +=
              event.contentBlockDelta.delta.toolUse.input ?? "";
          }

          // -- Content block stop --
          if (event.contentBlockStop !== undefined) {
            if (currentToolUseId && currentToolName) {
              // Finalize tool use block
              let parsedInput: Record<string, unknown> = {};
              try {
                parsedInput = JSON.parse(currentToolInputJson || "{}");
              } catch {
                // If JSON parsing fails, pass empty object
              }

              assistantContent.push({
                toolUse: {
                  toolUseId: currentToolUseId,
                  name: currentToolName,
                  input: parsedInput,
                },
              });

              // Reset tool state
              currentToolUseId = undefined;
              currentToolName = undefined;
              currentToolInputJson = "";
            } else if (currentText) {
              // Finalize text block
              assistantContent.push({ text: currentText });
              currentText = "";
            }
          }

          // -- Message stop --
          if (event.messageStop) {
            stopReason = event.messageStop.stopReason;
          }
        }
      }

      // Check if cancelled during streaming
      if (this.currentAbortController?.signal.aborted) {
        if (assistantContent.length > 0) {
          this.conversationHistory.push({
            role: "assistant",
            content: assistantContent,
          });
        }
        this.currentAbortController = null;
        return;
      }

      // Append the full assistant message to conversation history
      if (assistantContent.length > 0) {
        this.conversationHistory.push({
          role: "assistant",
          content: assistantContent,
        });
      }

      // ---- Decide what to do next ----

      // Check if there are tool_use blocks to execute
      const toolUseBlocks = assistantContent.filter(
        (block) => block.toolUse !== undefined,
      );

      if (toolUseBlocks.length > 0 && stopReason === "tool_use") {
        // Execute each tool and collect results
        const toolResultBlocks: ContentBlock[] = [];

        for (const block of toolUseBlocks) {
          const toolUse = block.toolUse!;
          const { toolUseId, name, input } = toolUse;

          this.emit("agent:tool_call", {
            toolUseId,
            name,
            input,
          });

          // Execute the tool
          const result = await executeTool(
            name!,
            (input as Record<string, unknown>) ?? {},
          );

          this.emit("agent:tool_result", {
            toolUseId,
            name,
            result,
          });

          // Emit file_changed for mutating tools, including file content
          if (FILE_MUTATING_TOOLS.has(name!)) {
            const toolInput = input as Record<string, unknown>;
            if (toolInput.path) {
              // For write_file, content is in the tool input.
              // For edit_file, read the file after the edit.
              let fileContent: string | undefined;
              if (name === "write_file") {
                fileContent = toolInput.content as string;
              } else {
                try {
                  const resolved = path.resolve("/home/workspace/project", toolInput.path as string);
                  fileContent = await fs.readFile(resolved, "utf-8");
                } catch {
                  // If read fails, emit without content
                }
              }
              this.emit("agent:file_changed", {
                path: toolInput.path as string,
                content: fileContent,
              });
            }
          }

          toolResultBlocks.push({
            toolResult: {
              toolUseId: toolUseId,
              content: [{ text: result }],
            },
          });
        }

        // Append tool results as a user message (Bedrock Converse format)
        this.conversationHistory.push({
          role: "user",
          content: toolResultBlocks,
        });

        // Loop back to call the model again with tool results
        continue;
      }

      // No tool calls — the model finished with end_turn
      // Emit all text blocks as final text
      for (const block of assistantContent) {
        if (block.text) {
          this.emit("agent:text", { text: block.text });
        }
      }

      // Done
      this.currentAbortController = null;
      return;
    }

    // If we've hit the iteration limit
    this.emit("agent:error", {
      error: "Agent loop exceeded maximum iterations. Stopping.",
    });
  }
}
