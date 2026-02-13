import { EventEmitter } from "events";
import {
  BedrockRuntimeClient,
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

// ---------------------------------------------------------------------------
// System prompt (Claude Code-style)
// ---------------------------------------------------------------------------

function buildSystemPrompt(repoMap?: string): string {
  const basePrompt = `You are an expert AI coding assistant, similar to Claude Code. You help hackathon participants build web applications autonomously and efficiently.

Capabilities:
- Bash: Execute any shell command. Working directory persists between calls. Use for npm, git, tests, builds.
- Read: Read files with optional offset/limit for large files.
- Write: Create or overwrite files. You must Read a file before Writing to it (unless creating new).
- Edit: Find-and-replace exact strings in files. The match must be unique.
- Glob: Find files by pattern (e.g. "**/*.tsx").
- Grep: Search file contents with regex. Supports context lines and output modes.
- ListDir: List directory contents.
- Task: Spawn a sub-agent for independent work. Use when tasks can run in parallel.

Rules:
- Be concise. Explain what you're doing briefly, then act.
- After code changes, remind the user to check the live preview.
- Use Bash to install packages, run tests, and manage git.
- Use Glob/Grep to understand the codebase before making changes.
- When creating files, ensure proper imports.
- Fix errors when they occur -- read the error, understand it, fix it.`;

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
  // Core agent loop
  // -------------------------------------------------------------------------

  private async runLoop(): Promise<void> {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const systemPrompt = buildSystemPrompt(this.repoMap);

      // Build the ConverseStream command with extended thinking enabled.
      // max_tokens must be greater than thinking.budget_tokens.
      const command = new ConverseStreamCommand({
        modelId: MODEL_ID,
        system: [{ text: systemPrompt }] as SystemContentBlock[],
        messages: this.conversationHistory,
        inferenceConfig: {
          maxTokens: 16384,
        },
        toolConfig: {
          tools: bedrockTools(),
        },
        additionalModelRequestFields: {
          thinking: {
            type: "enabled",
            budget_tokens: 8192,
          },
        },
      });

      // Collect the streamed response
      const response = await this.client.send(command);

      const assistantContent: ContentBlock[] = [];
      let stopReason: string | undefined;

      // ---- Parse the streaming response ----
      if (response.stream) {
        let currentText = "";
        let currentThinking = "";
        let currentThinkingSignature = "";
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

          // -- Reasoning/thinking delta (text chunks + signature) --
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reasoningDelta = (event.contentBlockDelta?.delta as any)?.reasoningContent as
            | { text?: string; signature?: string }
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
            } else if (currentBlockType === "thinking" && currentThinking) {
              // Finalize thinking/reasoning block with signature for conversation history
              assistantContent.push({
                reasoningContent: {
                  reasoningText: {
                    text: currentThinking,
                    signature: currentThinkingSignature || undefined,
                  },
                },
              } as ContentBlock);
              currentThinking = "";
              currentThinkingSignature = "";
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
      return;
    }

    // If we've hit the iteration limit
    this.emit("agent:error", {
      error: "Agent loop exceeded maximum iterations. Stopping.",
    });
  }
}
