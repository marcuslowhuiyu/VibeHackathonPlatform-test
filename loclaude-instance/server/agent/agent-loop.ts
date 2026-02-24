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
import { executeTool, TOOL_DEFINITIONS, resetReadTracking } from "./tools.js";

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
const MAX_ITERATIONS = 30; // slightly higher than vibe's 25 — Claude Code tasks tend to be more complex
const TOKEN_THRESHOLD = 150_000;  // ~150K tokens — trigger summarization

// ---------------------------------------------------------------------------
// System prompt (Claude Code-style)
// ---------------------------------------------------------------------------

function buildSystemPrompt(repoMap?: string): string {
  const basePrompt = `You are a friendly AI coding assistant helping a hackathon participant build a React web app. You take pride in producing beautiful, polished interfaces that look production-ready.

Styling:
- Always use Tailwind CSS utility classes for styling. Every component should be visually polished — never leave elements unstyled or with default browser styling.
- Ensure layouts are well-centered with proper spacing (p-4, gap-4, etc.), padding, and responsive design.
- Use a clean, consistent color palette. Prefer rounded corners, subtle shadows, and comfortable whitespace.
- Keep code simple and approachable. Prefer clean, readable component structures over clever abstractions.

Viewport & Layout (IMPORTANT):
- The app renders in a preview panel that is roughly 600–900px wide, NOT a full-screen browser window. Design with this constrained width in mind.
- Use fluid, responsive layouts: w-full, max-w-*, percentages, and flex-wrap. Never use fixed pixel widths greater than 500px.
- Design mobile-first: use single-column layouts by default, then expand with Tailwind responsive breakpoints (sm:, md:, lg:) for wider viewports.
- Use responsive grid patterns like grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 instead of fixed multi-column layouts.
- Ensure text, images, and containers scale fluidly — avoid overflow-x. Use max-w-full on images and media.
- Test mentally: "Would this look good at 700px wide?" If not, simplify the layout.

Capabilities:
- Bash: Execute any shell command. Working directory persists between calls. Use for npm, git, tests, builds.
- Read: Read files with optional offset/limit for large files.
- Write: Create or overwrite files. You must Read a file before Writing to it (unless creating new).
- Edit: Find-and-replace exact strings in files. The match must be unique.
- Glob: Find files by pattern (e.g. "**/*.tsx").
- Grep: Search file contents with regex. Supports context lines and output modes.
- ListDir: List directory contents.
- Task: Spawn a sub-agent for independent work. Use when tasks can run in parallel.

Live Preview:
- A Vite dev server is ALREADY running on port 3000 with hot module replacement (HMR). Do NOT start another dev server or run "npm run dev" / "npx vite". Your file changes are automatically reflected in the live preview.
- If the preview seems stuck, use the restart_preview tool (if available) or ask the user to refresh.

Rules:
- Explain what you're doing briefly, then act.
- After code changes, remind the user to check the live preview.
- Use Bash to install packages, run tests, and manage git — but NEVER to start a dev server.
- Use Glob/Grep to understand the codebase before making changes.
- When creating files, ensure proper imports.
- If something goes wrong, explain the error in plain language and fix it.`;

  if (repoMap) {
    return `${basePrompt}\n\nProject structure:\n<repo-map>\n${repoMap}\n</repo-map>`;
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
// "agent:thinking"     — { text: string }           model is producing text (streaming)
// "agent:text"         — { text: string }           final text block from the model
// "agent:tool_call"    — { toolUseId, name, input } model wants to call a tool
// "agent:tool_result"  — { toolUseId, name, result} tool execution finished
// "agent:file_changed" — { path: string }           a file was written or edited
// "agent:error"        — { error: string }          something went wrong
// ---------------------------------------------------------------------------

// Tools that modify files on disk (PascalCase to match loclaude tool names)
const FILE_MUTATING_TOOLS = new Set(["Write", "Edit"]);

// ---------------------------------------------------------------------------
// AgentLoop class
// ---------------------------------------------------------------------------

export class AgentLoop extends EventEmitter {
  private client: BedrockRuntimeClient;
  private conversationHistory: Message[] = [];
  private repoMap?: string;
  private currentAbortController: AbortController | null = null;
  private retryCount = 0;
  private tokenErrorCount = 0;

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

    // Find a clean split boundary — a user text message (not toolResult)
    let splitIndex = Math.max(2, Math.floor(this.conversationHistory.length * 0.6));
    while (splitIndex < this.conversationHistory.length - 2) {
      const msg = this.conversationHistory[splitIndex];
      if (msg.role === 'user') {
        const blocks = (msg.content ?? []) as ContentBlock[];
        const isPlainText = blocks.some((b) => b.text !== undefined) && !blocks.some((b) => b.toolResult !== undefined);
        if (isPlainText) break;
      }
      splitIndex++;
    }
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
  // Sub-agent execution (Task tool)
  // -------------------------------------------------------------------------

  private async executeSubTask(prompt: string): Promise<string> {
    // Create a child agent loop with the same repo map but fresh conversation.
    // Note: sub-agents share the same tool module state (read tracking, shell cwd).
    // resetReadTracking is available if isolation is needed in the future.
    const subAgent = new AgentLoop(this.repoMap);
    let result = '';

    return new Promise<string>((resolve) => {
      subAgent.on('agent:text', (data: { text: string }) => {
        result += data.text;
      });
      subAgent.on('agent:error', (data: { error: string }) => {
        resolve(`Sub-agent error: ${data.error}`);
      });

      subAgent.processMessage(prompt)
        .then(() => resolve(result || '(sub-agent produced no text output)'))
        .catch((err: Error) => resolve(`Sub-agent failed: ${err.message}`));
    });
  }

  // -------------------------------------------------------------------------
  // Thinking history helpers
  // -------------------------------------------------------------------------

  /**
   * Return a copy of the conversation history with all reasoningContent blocks
   * removed from assistant messages. Used as a fallback when the API rejects
   * thinking blocks in the history (e.g. missing signatures, redacted content
   * format mismatch).
   */
  private stripThinkingFromHistory(): Message[] {
    return this.conversationHistory.map((msg) => {
      if (msg.role !== "assistant" || !msg.content) return msg;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtered = (msg.content as ContentBlock[]).filter(
        (block) => (block as any)?.reasoningContent === undefined,
      );
      // If all blocks were thinking (unlikely), keep at least a minimal text block
      if (filtered.length === 0) {
        return { ...msg, content: [{ text: "(thinking)" }] };
      }
      return { ...msg, content: filtered };
    });
  }

  // -------------------------------------------------------------------------
  // Core agent loop
  // -------------------------------------------------------------------------

  private async runLoop(): Promise<void> {
    let thinkingDisabled = false; // Fallback flag if thinking blocks cause API errors

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Pre-flight: proactively compact if approaching model limit
      const preFlightTokens = this.estimateTokens();
      if (preFlightTokens > 120_000) {
        console.log(`Pre-flight token check: ~${preFlightTokens} tokens, proactively compacting...`);
        await this.compactHistory();
      }

      const systemPrompt = buildSystemPrompt(this.repoMap);

      this.currentAbortController = new AbortController();

      // Build the ConverseStream command.
      // Extended thinking is enabled by default but may be disabled as a fallback
      // if the conversation history triggers validation errors.
      const command = new ConverseStreamCommand({
        modelId: MODEL_ID,
        system: [{ text: systemPrompt }] as SystemContentBlock[],
        messages: thinkingDisabled
          ? this.stripThinkingFromHistory()
          : this.conversationHistory,
        inferenceConfig: {
          maxTokens: 16384,
        },
        toolConfig: {
          tools: bedrockTools(),
        },
        ...(thinkingDisabled
          ? {}
          : {
              additionalModelRequestFields: {
                thinking: {
                  type: "enabled",
                  budget_tokens: 8192,
                },
              },
            }),
      });

      // Collect the streamed response — if thinking history causes a validation
      // error, strip thinking blocks and retry without thinking for this iteration.
      let response;
      try {
        response = await this.client.send(command, {
          abortSignal: this.currentAbortController.signal,
        });
      } catch (err: unknown) {
        // Check for cancellation
        if (err instanceof Error && err.name === 'AbortError') {
          this.currentAbortController = null;
          return;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        // Token limit error — force truncate and retry
        const errLower = errMsg.toLowerCase();
        if (errLower.includes('too many tokens') || errLower.includes('too long') || errLower.includes('input is too long') || errLower.includes('throttl')) {
          this.tokenErrorCount++;
          if (this.tokenErrorCount >= 3) {
            console.warn('3 consecutive token errors — hard-resetting conversation');
            const lastUserMsg = this.conversationHistory.filter(m => m.role === 'user').pop();
            const lastText = lastUserMsg?.content
              ? (lastUserMsg.content as ContentBlock[]).find(b => b.text)?.text ?? ''
              : '';
            this.conversationHistory = [
              { role: 'user', content: [{ text: `[Previous conversation was too long and has been reset. You were working on: ${lastText.slice(0, 500)}]` }] },
              { role: 'assistant', content: [{ text: 'Understood. The conversation was getting too long, so I have a fresh context now. Let me continue where we left off.' }] },
            ];
            this.tokenErrorCount = 0;
            continue;
          }
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
          continue; // Retry the iteration with truncated history
        }
        if (!thinkingDisabled && errMsg.includes("thinking")) {
          // Thinking history is corrupted — retry without thinking
          thinkingDisabled = true;
          const fallbackCommand = new ConverseStreamCommand({
            modelId: MODEL_ID,
            system: [{ text: systemPrompt }] as SystemContentBlock[],
            messages: this.stripThinkingFromHistory(),
            inferenceConfig: {
              maxTokens: 16384,
            },
            toolConfig: {
              tools: bedrockTools(),
            },
          });
          response = await this.client.send(fallbackCommand, {
            abortSignal: this.currentAbortController!.signal,
          });
        } else {
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
      }
      this.retryCount = 0;
      this.tokenErrorCount = 0;

      const assistantContent: ContentBlock[] = [];
      let stopReason: string | undefined;

      // ---- Parse the streaming response ----
      if (response.stream) {
        let currentText = "";
        let currentThinking = "";
        let currentThinkingSignature = "";
        let currentRedactedChunks: Uint8Array[] = [];
        let currentBlockType: "thinking" | "text" | "toolUse" = "text";
        let currentToolUseId: string | undefined;
        let currentToolName: string | undefined;
        let currentToolInputJson = "";

        for await (const event of response.stream as AsyncIterable<ConverseStreamOutput>) {
          // -- Content block start --
          if (event.contentBlockStart !== undefined) {
            if (event.contentBlockStart.start?.toolUse) {
              currentBlockType = "toolUse";
              const toolStart = event.contentBlockStart.start.toolUse;
              currentToolUseId = toolStart.toolUseId;
              currentToolName = toolStart.name;
              currentToolInputJson = "";
            } else {
              // Will be determined by the first delta (thinking vs text)
              currentBlockType = "text";
            }
          }

          // -- Reasoning/thinking delta (text chunks, signature, or redacted content) --
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reasoningDelta = (event.contentBlockDelta?.delta as any)?.reasoningContent as
            | { text?: string; signature?: string; redactedContent?: Uint8Array }
            | undefined;
          if (reasoningDelta) {
            currentBlockType = "thinking";
            if (reasoningDelta.text) {
              currentThinking += reasoningDelta.text;
              this.emit("agent:thinking", { text: reasoningDelta.text });
            }
            if (reasoningDelta.signature) {
              currentThinkingSignature = reasoningDelta.signature;
            }
            if (reasoningDelta.redactedContent) {
              currentRedactedChunks.push(reasoningDelta.redactedContent);
            }
          }

          // -- Text delta --
          if (event.contentBlockDelta?.delta?.text) {
            const chunk = event.contentBlockDelta.delta.text;
            currentText += chunk;
            this.emit("agent:thinking", { text: chunk });
          }

          // -- Tool input delta --
          if (event.contentBlockDelta?.delta?.toolUse) {
            currentToolInputJson +=
              event.contentBlockDelta.delta.toolUse.input ?? "";
          }

          // -- Content block stop --
          if (event.contentBlockStop !== undefined) {
            if (currentBlockType === "toolUse" && currentToolUseId && currentToolName) {
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
            } else if (currentBlockType === "thinking") {
              if (currentThinking) {
                // Finalize thinking/reasoning block with text + signature
                assistantContent.push({
                  reasoningContent: {
                    reasoningText: {
                      text: currentThinking,
                      signature: currentThinkingSignature || undefined,
                    },
                  },
                } as ContentBlock);
              } else if (currentRedactedChunks.length > 0) {
                // Finalize redacted thinking block (encrypted content from the model)
                const totalLength = currentRedactedChunks.reduce((sum, c) => sum + c.length, 0);
                const merged = new Uint8Array(totalLength);
                let off = 0;
                for (const chunk of currentRedactedChunks) {
                  merged.set(chunk, off);
                  off += chunk.length;
                }
                assistantContent.push({
                  reasoningContent: {
                    redactedContent: merged,
                  },
                } as ContentBlock);
              }
              // Reset thinking state
              currentThinking = "";
              currentThinkingSignature = "";
              currentRedactedChunks = [];
            } else if (currentText) {
              // Finalize text block
              assistantContent.push({ text: currentText });
              currentText = "";
            }
            currentBlockType = "text";
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

      // Safety net: when thinking is enabled, ensure assistant content starts
      // with reasoningContent (required by the API). If the model somehow
      // didn't produce a thinking block, or the stream delivered blocks in
      // an unexpected order, fix it here.
      if (!thinkingDisabled && assistantContent.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const firstHasReasoning = (assistantContent[0] as any)?.reasoningContent !== undefined;
        if (!firstHasReasoning) {
          // Try to find a reasoningContent block elsewhere and move it to front
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reasoningIdx = assistantContent.findIndex(
            (b) => (b as any)?.reasoningContent !== undefined,
          );
          if (reasoningIdx > 0) {
            const [reasoningBlock] = assistantContent.splice(reasoningIdx, 1);
            assistantContent.unshift(reasoningBlock);
          } else {
            // No thinking block at all — insert a minimal placeholder.
            // The signature field is optional per the SDK types.
            assistantContent.unshift({
              reasoningContent: {
                reasoningText: {
                  text: "Continuing with the task.",
                },
              },
            } as ContentBlock);
          }
        }
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

          let result: string;

          // Intercept the Task tool — handle sub-agents inside the loop
          if (name === "Task") {
            const taskPrompt = (input as Record<string, unknown>).prompt as string;
            result = await this.executeSubTask(taskPrompt);
          } else {
            // Execute the tool normally
            result = await executeTool(
              name!,
              (input as Record<string, unknown>) ?? {},
            );
          }

          this.emit("agent:tool_result", {
            toolUseId,
            name,
            result,
          });

          // Emit file_changed for mutating tools, including file content
          if (FILE_MUTATING_TOOLS.has(name!)) {
            const toolInput = input as Record<string, unknown>;
            const filePath = toolInput.file_path as string | undefined;
            if (filePath) {
              let fileContent: string | undefined;
              if (name === "Write") {
                fileContent = toolInput.content as string;
              } else {
                try {
                  const resolved = path.resolve("/home/workspace/project", filePath);
                  fileContent = await fs.readFile(resolved, "utf-8");
                } catch {
                  // If read fails, emit without content
                }
              }
              this.emit("agent:file_changed", {
                path: filePath,
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
