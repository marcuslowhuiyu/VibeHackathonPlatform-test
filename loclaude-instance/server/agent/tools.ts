import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { glob } from "glob";

const PROJECT_ROOT = "/home/workspace/project";

// ---------------------------------------------------------------------------
// Path-safety helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a file path to an absolute path within the project sandbox.
 * Throws if the resolved path escapes PROJECT_ROOT.
 */
function resolveSandboxed(filePath: string): string {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT + "/") && resolved !== PROJECT_ROOT) {
    throw new Error(
      `Path traversal blocked: "${filePath}" resolves outside project root`,
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Blocked command patterns (shared by Bash tool)
// ---------------------------------------------------------------------------

const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
];

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Persistent working directory for the Bash tool, survives between calls. */
let shellCwd = PROJECT_ROOT;

/** Set of absolute file paths that have been read (for read-before-write). */
const readFiles = new Set<string>();

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * 1. Bash — persistent working directory shell
 */
async function bashTool(
  command: string,
  timeoutMs: number = 120000,
): Promise<string> {
  // Safety: block dangerous command patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(
        `Blocked: command matches dangerous pattern "${pattern.source}"`,
      );
    }
  }

  return new Promise<string>((resolve) => {
    // Run inside a sub-shell that cd's to the persisted cwd first, then
    // echoes the final working directory via a sentinel line.
    const wrappedCommand = `cd "${shellCwd}" && ${command} && echo "___CWD___$(pwd)"`;

    const child = spawn("bash", ["-c", wrappedCommand], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: "/home/workspace" },
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill("SIGKILL");
        resolve(
          JSON.stringify({
            exit_code: -1,
            output: `[timeout after ${timeoutMs}ms]\n${(stdout + stderr).slice(0, 50000)}`,
            cwd: shellCwd,
          }),
        );
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve(
          JSON.stringify({
            exit_code: -1,
            output: `spawn error: ${err.message}`,
            cwd: shellCwd,
          }),
        );
      }
    });

    child.on("close", (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);

        // Extract the sentinel ___CWD___ line and update persistent cwd
        const cwdMatch = stdout.match(/___CWD___(.*)/);
        if (cwdMatch) {
          shellCwd = cwdMatch[1].trim();
          stdout = stdout.replace(/___CWD___.*\n?/, "").trimEnd();
        }

        const combined =
          stdout + (stderr ? `\nSTDERR:\n${stderr}` : "");

        resolve(
          JSON.stringify({
            exit_code: code ?? -1,
            output: combined.slice(0, 50000),
            cwd: shellCwd,
          }),
        );
      }
    });
  });
}

/**
 * 2. Read — read a file with optional offset/limit, tracks read files
 */
async function readTool(
  filePath: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  const resolved = resolveSandboxed(filePath);
  readFiles.add(resolved);

  const content = await fs.readFile(resolved, "utf-8");
  const lines = content.split("\n");

  const start = offset ?? 0;
  const end = limit ? start + limit : lines.length;
  const sliced = lines.slice(start, end);

  return sliced.map((line, i) => `${start + i + 1}\t${line}`).join("\n");
}

/**
 * 3. Write — write a file with read-before-write enforcement for existing files
 */
async function writeTool(
  filePath: string,
  content: string,
): Promise<string> {
  const resolved = resolveSandboxed(filePath);

  // Enforce read-before-write for existing files
  let fileExists = false;
  try {
    await fs.access(resolved);
    fileExists = true;
  } catch {
    // File does not exist — new file, no read required
  }

  if (fileExists && !readFiles.has(resolved)) {
    throw new Error(
      `Must read ${filePath} before writing to it. Use the Read tool first.`,
    );
  }

  // Ensure parent directories exist
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf-8");

  // Mark as read after writing so subsequent writes don't require another read
  readFiles.add(resolved);

  return JSON.stringify({
    status: "ok",
    path: resolved,
    bytes: Buffer.byteLength(content, "utf-8"),
  });
}

/**
 * 4. Edit — exact string replacement (old_string must appear exactly once)
 */
async function editTool(
  filePath: string,
  oldString: string,
  newString: string,
): Promise<string> {
  const resolved = resolveSandboxed(filePath);
  const content = await fs.readFile(resolved, "utf-8");

  const occurrences = content.split(oldString).length - 1;

  if (occurrences === 0) {
    throw new Error(
      `old_string not found in ${filePath}. Make sure it matches exactly (including whitespace and newlines).`,
    );
  }

  if (occurrences > 1) {
    throw new Error(
      `old_string appears ${occurrences} times in ${filePath}. It must be unique — provide more surrounding context to disambiguate.`,
    );
  }

  const updated = content.replace(oldString, newString);
  await fs.writeFile(resolved, updated, "utf-8");

  return JSON.stringify({ status: "ok", path: resolved, replacements: 1 });
}

/**
 * 5. Glob — file pattern matching
 */
async function globTool(
  pattern: string,
  searchPath?: string,
): Promise<string> {
  const baseDir = searchPath
    ? resolveSandboxed(searchPath)
    : PROJECT_ROOT;

  const matches = await glob(pattern, {
    cwd: baseDir,
    ignore: ["node_modules/**", ".git/**"],
    nodir: false,
  });

  if (matches.length === 0) {
    return `No files matched pattern: ${pattern}`;
  }

  return matches.join("\n");
}

/**
 * 6. Grep — ripgrep with output modes
 */
async function grepTool(
  pattern: string,
  searchPath?: string,
  contextLines: number = 0,
  outputMode: "content" | "files_with_matches" | "count" = "content",
): Promise<string> {
  const baseDir = searchPath
    ? resolveSandboxed(searchPath)
    : PROJECT_ROOT;

  return new Promise<string>((resolve) => {
    const args = [
      "--no-heading",
      "--line-number",
      "--color=never",
      "--glob=!node_modules/**",
      "--glob=!.git/**",
    ];

    // Map output_mode to rg flags
    if (outputMode === "files_with_matches") {
      args.push("--files-with-matches");
    } else if (outputMode === "count") {
      args.push("--count");
    }

    if (contextLines > 0 && outputMode === "content") {
      args.push("-C", String(contextLines));
    }

    args.push(pattern, baseDir);

    const child = spawn("rg", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      // ripgrep not available — return a helpful fallback message
      resolve(
        "ripgrep (rg) is not available. Install it or use the Bash tool with grep.",
      );
    });

    child.on("close", (code) => {
      if (code === 1 && stdout === "") {
        // rg exit code 1 = no matches
        resolve(`No matches found for pattern: ${pattern}`);
        return;
      }
      if (code !== 0 && code !== 1) {
        resolve(`grep error (exit ${code}): ${stderr || stdout}`);
        return;
      }
      // Make paths relative to PROJECT_ROOT for readability
      const output = stdout.replace(
        new RegExp(PROJECT_ROOT + "/", "g"),
        "",
      );
      resolve(output.trim());
    });
  });
}

/**
 * 7. ListDir — directory listing up to 2 levels deep
 */
async function listDirTool(dirPath?: string): Promise<string> {
  const resolved = resolveSandboxed(dirPath ?? ".");

  const entries: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 2) return;

    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      // Skip common non-source directories
      if (
        item.isDirectory() &&
        ["node_modules", ".git", "dist", ".next", ".cache"].includes(
          item.name,
        )
      ) {
        continue;
      }

      const full = path.join(dir, item.name);
      const rel = path.relative(PROJECT_ROOT, full);

      if (item.isDirectory()) {
        entries.push(rel + "/");
        await walk(full, depth + 1);
      } else {
        entries.push(rel);
      }
    }
  }

  await walk(resolved, 0);
  return entries.join("\n") || "(empty directory)";
}

/**
 * 8. Task — sub-agent spawning placeholder
 *
 * The actual Task execution is intercepted in agent-loop.ts before reaching
 * executeTool. This implementation is only a fallback if the intercept fails.
 */
function taskTool(prompt: string, _description?: string): string {
  return JSON.stringify({
    status: "error",
    message:
      "Task tool must be handled by the agent loop. " +
      "If you see this message, the agent loop did not intercept this tool call. " +
      `Prompt was: "${prompt.slice(0, 100)}..."`,
  });
}

// ---------------------------------------------------------------------------
// Public: reset read tracking (for sub-agents that need a clean slate)
// ---------------------------------------------------------------------------

/**
 * Clear the read-tracking set so sub-agents start fresh.
 * Also resets the shell cwd to PROJECT_ROOT.
 */
export function resetReadTracking(): void {
  readFiles.clear();
  shellCwd = PROJECT_ROOT;
}

// ---------------------------------------------------------------------------
// Bedrock-compatible tool definitions
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    name: "Bash",
    description:
      "Execute a shell command via bash. The working directory persists between calls — " +
      "if you cd into a directory, subsequent Bash calls will start there. " +
      "Dangerous commands (rm -rf /, mkfs, dd, writing to /dev/sd*) are blocked. " +
      "Returns JSON with exit_code, output (stdout+stderr, truncated to 50k chars), and cwd.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout: {
          type: "number",
          description:
            "Timeout in milliseconds (default 120000). The command is killed if it exceeds this.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "Read",
    description:
      "Read the contents of a file and return it with line numbers. " +
      "Supports optional offset and limit for reading large files in chunks. " +
      "Path is relative to the project root.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Relative or absolute path to the file to read",
        },
        offset: {
          type: "number",
          description:
            "Line offset to start reading from (0-based, default 0)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to return",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "Write",
    description:
      "Write content to a file, creating it (and parent directories) if needed. " +
      "If the file already exists, you MUST Read it first or the write will be rejected. " +
      "New files (that don't exist yet) can be written without prior Read.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Relative or absolute path to the file to write",
        },
        content: {
          type: "string",
          description: "The full content to write to the file",
        },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "Edit",
    description:
      "Find an exact string in a file and replace it with a new string. " +
      "The old_string must appear exactly once in the file — if it appears 0 or more " +
      "than 1 time, the edit will fail. Provide enough surrounding context to be unique.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Relative or absolute path to the file to edit",
        },
        old_string: {
          type: "string",
          description:
            "The exact string to find (must match uniquely, including whitespace and newlines)",
        },
        new_string: {
          type: "string",
          description: "The replacement string",
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "Glob",
    description:
      "Fast file pattern matching using glob syntax. Returns matching file paths " +
      "relative to the search directory, one per line. " +
      'Ignores node_modules/ and .git/ by default. Example: "**/*.tsx".',
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description:
            'Glob pattern to match (e.g. "**/*.ts", "src/**/*.tsx")',
        },
        path: {
          type: "string",
          description:
            "Directory to search in (defaults to project root)",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description:
      "Search file contents using regex via ripgrep. Supports three output modes: " +
      '"content" (default, shows matching lines), "files_with_matches" (file paths only), ' +
      '"count" (match counts per file). Ignores node_modules/ and .git/.',
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for in file contents",
        },
        path: {
          type: "string",
          description:
            "Directory to search in (defaults to project root)",
        },
        context_lines: {
          type: "number",
          description:
            "Number of context lines to show before and after each match (default 0, only for content mode)",
        },
        output_mode: {
          type: "string",
          description:
            'Output mode: "content" (matching lines, default), "files_with_matches" (file paths), "count" (match counts)',
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "ListDir",
    description:
      "List files and directories recursively up to 2 levels deep. " +
      'Directories are shown with a trailing "/" suffix. ' +
      "Skips node_modules, .git, dist, .next, and .cache directories.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Directory to list (defaults to project root)",
        },
      },
      required: [],
    },
  },
  {
    name: "Task",
    description:
      "Spawn a sub-agent to handle a complex task autonomously. The sub-agent has " +
      "access to all tools and its own conversation context. Use for independent " +
      "tasks that can be delegated (e.g. implementing a feature, fixing a bug, " +
      "writing tests). The sub-agent will return its final text output.",
    input_schema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Detailed task description for the sub-agent",
        },
        description: {
          type: "string",
          description:
            "Short description of the task (shown in UI while running)",
        },
      },
      required: ["prompt"],
    },
  },
];

// ---------------------------------------------------------------------------
// Unified tool executor
// ---------------------------------------------------------------------------

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "Bash":
        return await bashTool(
          input.command as string,
          (input.timeout as number | undefined) ?? 120000,
        );

      case "Read":
        return await readTool(
          input.file_path as string,
          input.offset as number | undefined,
          input.limit as number | undefined,
        );

      case "Write":
        return await writeTool(
          input.file_path as string,
          input.content as string,
        );

      case "Edit":
        return await editTool(
          input.file_path as string,
          input.old_string as string,
          input.new_string as string,
        );

      case "Glob":
        return await globTool(
          input.pattern as string,
          input.path as string | undefined,
        );

      case "Grep":
        return await grepTool(
          input.pattern as string,
          input.path as string | undefined,
          (input.context_lines as number | undefined) ?? 0,
          (input.output_mode as
            | "content"
            | "files_with_matches"
            | "count"
            | undefined) ?? "content",
        );

      case "ListDir":
        return await listDirTool(input.path as string | undefined);

      case "Task":
        return taskTool(
          input.prompt as string,
          input.description as string | undefined,
        );

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}
