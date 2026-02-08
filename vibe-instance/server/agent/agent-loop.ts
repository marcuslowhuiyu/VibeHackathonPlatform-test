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
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_ID = process.env.BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-20250514-v1:0";
const MAX_ITERATIONS = 25; // safety limit to prevent infinite loops

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  mode: "vibe" | "vibe-pro",
  repoMap?: string,
): string {
  const basePrompt = `You are a friendly AI coding assistant helping a non-technical hackathon participant build a React web app.

Key rules:
- You can only read and modify files within the project directory.
- Always explain what you are doing in simple, beginner-friendly terms before and after making changes.
- Keep code simple and beginner-friendly. Avoid overly clever patterns.
- After making changes to code, remind the user to check the live preview to see the results.
- When creating new files, also make sure they are properly imported where needed.
- If something goes wrong, explain the error in plain language and suggest a fix.

${mode === "vibe" ? "The user is in VIBE mode — they describe what they want in plain English and you build it for them. Be proactive: scaffold files, install patterns, and wire things up without asking too many questions." : "The user is in VIBE-PRO mode — they have some coding experience. You can be slightly more technical in explanations, but still keep things clear and approachable."}`;

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
  private instanceMode: "vibe" | "vibe-pro";
  private repoMap?: string;

  constructor(instanceMode: "vibe" | "vibe-pro", repoMap?: string) {
    super();
    this.instanceMode = instanceMode;
    this.repoMap = repoMap;
    this.client = new BedrockRuntimeClient({});
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

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
      const systemPrompt = buildSystemPrompt(
        this.instanceMode,
        this.repoMap,
      );

      const command = new ConverseStreamCommand({
        modelId: MODEL_ID,
        system: [{ text: systemPrompt }] as SystemContentBlock[],
        messages: this.conversationHistory,
        toolConfig: {
          tools: bedrockTools(),
        },
      });

      // Collect the streamed response
      const response = await this.client.send(command);

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

          // Emit file_changed for mutating tools
          if (FILE_MUTATING_TOOLS.has(name!)) {
            const toolInput = input as Record<string, unknown>;
            if (toolInput.path) {
              this.emit("agent:file_changed", {
                path: toolInput.path as string,
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
