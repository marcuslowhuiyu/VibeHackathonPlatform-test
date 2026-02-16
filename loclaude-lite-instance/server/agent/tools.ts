import fs from "fs/promises";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { glob } from "glob";

const PROJECT_ROOT = "/home/workspace/project";

// ---------------------------------------------------------------------------
// Path-safety helpers
// ---------------------------------------------------------------------------

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
// Module-level state for the preview dev-server process
// ---------------------------------------------------------------------------

let previewProcess: ChildProcess | null = null;

// ---------------------------------------------------------------------------
// Blocked command patterns for bash_command safety
// ---------------------------------------------------------------------------

const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
];

// ---------------------------------------------------------------------------
// Tool implementations (original 6 from Vibe)
// ---------------------------------------------------------------------------

async function readFile(filePath: string): Promise<string> {
  const resolved = resolveSandboxed(filePath);
  const content = await fs.readFile(resolved, "utf-8");
  const lines = content.split("\n");
  const numbered = lines.map((line, i) => `${i + 1}\t${line}`);
  return numbered.join("\n");
}

async function writeFile(filePath: string, content: string): Promise<string> {
  const resolved = resolveSandboxed(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf-8");
  const bytes = Buffer.byteLength(content, "utf-8");
  return JSON.stringify({ status: "ok", path: resolved, bytes });
}

async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
): Promise<string> {
  const resolved = resolveSandboxed(filePath);
  const content = await fs.readFile(resolved, "utf-8");

  if (!content.includes(oldString)) {
    throw new Error(
      `old_string not found in ${resolved}. Make sure it matches exactly (including whitespace).`,
    );
  }

  const occurrences = content.split(oldString).length - 1;
  if (occurrences > 1) {
    throw new Error(
      `old_string appears ${occurrences} times in ${resolved}. It must be unique — provide more surrounding context.`,
    );
  }

  const updated = content.replace(oldString, newString);
  await fs.writeFile(resolved, updated, "utf-8");
  return JSON.stringify({ status: "ok", path: resolved, replacements: 1 });
}

async function listFiles(dirPath?: string): Promise<string> {
  const resolved = resolveSandboxed(dirPath ?? ".");

  const entries: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 2) return;
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
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
  return entries.join("\n");
}

async function searchFiles(
  pattern: string,
  dirPath?: string,
): Promise<string> {
  const resolved = resolveSandboxed(dirPath ?? ".");
  const regex = new RegExp(pattern);
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);

      // Skip common non-source directories
      if (
        item.isDirectory() &&
        ["node_modules", ".git", "dist", ".next", ".cache"].includes(item.name)
      ) {
        continue;
      }

      if (item.isDirectory()) {
        await walk(full);
      } else {
        try {
          const content = await fs.readFile(full, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const rel = path.relative(PROJECT_ROOT, full);
              results.push(`${rel}:${i + 1}: ${lines[i]}`);
            }
          }
        } catch {
          // Skip binary / unreadable files
        }
      }
    }
  }

  await walk(resolved);
  return results.length > 0
    ? results.join("\n")
    : `No matches found for pattern: ${pattern}`;
}

async function restartPreview(): Promise<string> {
  // Kill existing process if running
  if (previewProcess && !previewProcess.killed) {
    previewProcess.kill("SIGTERM");

    // Give it a moment to terminate, then force-kill
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (previewProcess && !previewProcess.killed) {
          previewProcess.kill("SIGKILL");
        }
        resolve();
      }, 3000);

      previewProcess!.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // Start a new Vite dev server on port 3000
  previewProcess = spawn("npx", ["vite", "--port", "3000", "--host"], {
    cwd: PROJECT_ROOT,
    stdio: "ignore",
    detached: false,
    shell: true,
  });

  const pid = previewProcess.pid;

  previewProcess.on("error", (err) => {
    console.error("[preview] failed to start:", err.message);
  });

  previewProcess.on("exit", (code) => {
    console.log(`[preview] exited with code ${code}`);
    previewProcess = null;
  });

  return JSON.stringify({
    status: "ok",
    message: "Preview server restarting on port 3000",
    pid,
  });
}

// ---------------------------------------------------------------------------
// NEW tool implementations (4 new tools for loclaude-lite)
// ---------------------------------------------------------------------------

async function bashCommand(
  command: string,
  timeoutMs: number = 30000,
): Promise<string> {
  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(
        `Blocked: command matches dangerous pattern "${pattern.source}"`,
      );
    }
  }

  return new Promise<string>((resolve) => {
    const child = spawn("bash", ["-c", command], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: "/root" },
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
          }),
        );
      }
    });

    child.on("close", (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        const combined = (stdout + stderr).slice(0, 50000);
        resolve(
          JSON.stringify({
            exit_code: code ?? -1,
            output: combined,
          }),
        );
      }
    });
  });
}

async function globFiles(
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

async function grepSearch(
  pattern: string,
  searchPath?: string,
  contextLines: number = 0,
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

    if (contextLines > 0) {
      args.push(`-C`, String(contextLines));
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
        "ripgrep (rg) is not available. Use search_files for basic regex search.",
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

async function gitStatus(): Promise<string> {
  return new Promise<string>((resolve) => {
    const child = spawn("git", ["status", "--short"], {
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

    child.on("error", (err) => {
      resolve(`git error: ${err.message}`);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(`git error (exit ${code}): ${stderr || stdout}`);
        return;
      }
      const output = stdout.trim();
      resolve(output || "(clean)");
    });
  });
}

// ---------------------------------------------------------------------------
// Bedrock-compatible tool definitions
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  // --- Original 6 tools from Vibe ---
  {
    name: "read_file",
    description:
      "Read the contents of a file and return it with line numbers. " +
      "Path is relative to the project root.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to read",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file, creating it (and parent directories) if needed. " +
      "If the file exists it will be overwritten. Path is relative to the project root.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to write",
        },
        content: {
          type: "string",
          description: "The full content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Find an exact string in a file and replace it with a new string. " +
      "The old_string must appear exactly once in the file. " +
      "Path is relative to the project root.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to edit",
        },
        old_string: {
          type: "string",
          description:
            "The exact string to find (must match uniquely, including whitespace)",
        },
        new_string: {
          type: "string",
          description: "The replacement string",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "list_files",
    description:
      "List files and directories recursively (up to 2 levels deep). " +
      "Path is relative to the project root. Defaults to the project root if omitted.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Relative path to the directory to list (defaults to project root)",
        },
      },
      required: [],
    },
  },
  {
    name: "search_files",
    description:
      "Search for a regex pattern across all project files (like grep). " +
      "Skips node_modules, .git, dist, .next, and .cache directories. " +
      "Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression pattern to search for",
        },
        path: {
          type: "string",
          description:
            "Relative path to narrow the search directory (defaults to project root)",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "restart_preview",
    description:
      "Kill the running Vite dev-server preview (if any) and restart it on port 3000. " +
      "Use this after making changes that require a server restart.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // --- 4 new tools for loclaude-lite ---
  {
    name: "bash_command",
    description:
      "Execute a shell command via bash. The command runs with cwd set to the project root. " +
      "Dangerous commands (rm -rf /, mkfs, dd, writing to /dev/sd*) are blocked. " +
      "Returns JSON with exit_code and output (stdout+stderr, truncated to 50000 chars).",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout_ms: {
          type: "number",
          description:
            "Timeout in milliseconds (default 30000). The command is killed if it exceeds this.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "glob",
    description:
      "Fast file pattern matching using glob syntax. Returns matching file paths " +
      "relative to the search directory, one per line. " +
      "Ignores node_modules/ and .git/ by default.",
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
            "Relative path to the directory to search in (defaults to project root)",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description:
      "Search file contents using regex via ripgrep. Returns matching lines in " +
      "file:line_number:content format. Ignores node_modules/ and .git/. " +
      "Falls back to a message if ripgrep is not installed.",
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
            "Relative path to narrow the search directory (defaults to project root)",
        },
        context_lines: {
          type: "number",
          description:
            "Number of context lines to show before and after each match (default 0)",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "git_status",
    description:
      'Run "git status --short" in the project root. Returns the short status ' +
      'output, or "(clean)" if there are no changes.',
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
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
      // Original 6 tools
      case "read_file":
        return await readFile(input.path as string);

      case "write_file":
        return await writeFile(
          input.path as string,
          input.content as string,
        );

      case "edit_file":
        return await editFile(
          input.path as string,
          input.old_string as string,
          input.new_string as string,
        );

      case "list_files":
        return await listFiles(input.path as string | undefined);

      case "search_files":
        return await searchFiles(
          input.pattern as string,
          input.path as string | undefined,
        );

      case "restart_preview":
        return await restartPreview();

      // 4 new tools
      case "bash_command":
        return await bashCommand(
          input.command as string,
          (input.timeout_ms as number | undefined) ?? 30000,
        );

      case "glob":
        return await globFiles(
          input.pattern as string,
          input.path as string | undefined,
        );

      case "grep":
        return await grepSearch(
          input.pattern as string,
          input.path as string | undefined,
          (input.context_lines as number | undefined) ?? 0,
        );

      case "git_status":
        return await gitStatus();

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}
