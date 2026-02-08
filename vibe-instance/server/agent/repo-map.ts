import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const INCLUDED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".json",
]);

const SKIPPED_DIRS = new Set(["node_modules", "dist", ".git"]);

/** Approximate character budget (~4000 tokens at ~4 chars/token). */
const MAX_OUTPUT_CHARS = 16000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileSummary {
  path: string;
  imports: string[];
  exports: string[];
  functions: string[];
}

// ---------------------------------------------------------------------------
// Directory walker
// ---------------------------------------------------------------------------

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (INCLUDED_EXTENSIONS.has(ext)) {
          results.push(full);
        }
      }
    }
  }

  await walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// Regex-based file parsing
// ---------------------------------------------------------------------------

function extractImports(content: string): string[] {
  const imports: string[] = [];

  // ES module imports: import ... from '...'
  const importFromRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importFromRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Side-effect imports: import '...'
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Deduplicate while preserving order
  return [...new Set(imports)];
}

function extractExports(content: string): string[] {
  const exports: string[] = [];

  // export default function/class/component Name
  const defaultFuncRegex =
    /export\s+default\s+(?:function|class)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = defaultFuncRegex.exec(content)) !== null) {
    exports.push(`${match[1]} (default)`);
  }

  // export default Name  (identifier only, not expression)
  const defaultIdRegex = /export\s+default\s+([A-Z]\w*)\s*;/g;
  while ((match = defaultIdRegex.exec(content)) !== null) {
    exports.push(`${match[1]} (default)`);
  }

  // Named exports: export function X, export class X, export const X, export type X, export interface X
  const namedExportRegex =
    /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Deduplicate
  return [...new Set(exports)];
}

function extractFunctions(content: string): string[] {
  const names: string[] = [];

  // function declarations: function Name(
  const funcDeclRegex = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = funcDeclRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  // Arrow functions / function expressions assigned to const:
  // const Name = (...) => or const Name = function
  const arrowRegex =
    /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:(?:\([^)]*\)|[^=])\s*=>|function)/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  // React components: const Name = React.memo( / React.forwardRef( / styled.
  const reactPatternRegex =
    /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:React\.(?:memo|forwardRef)|styled\.\w+)/g;
  while ((match = reactPatternRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  // Class declarations: class Name
  const classRegex = /(?:^|\n)\s*(?:export\s+)?class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  return [...new Set(names)];
}

function parseFile(content: string, ext: string): Omit<FileSummary, "path"> {
  // For non-script files, skip parsing
  if (ext === ".css" || ext === ".json") {
    return { imports: [], exports: [], functions: [] };
  }

  return {
    imports: extractImports(content),
    exports: extractExports(content),
    functions: extractFunctions(content),
  };
}

// ---------------------------------------------------------------------------
// Sorting / prioritisation
// ---------------------------------------------------------------------------

/** Rank file extensions for priority — lower number = higher priority. */
function extensionPriority(filePath: string): number {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return 0;
    case ".ts":
      return 1;
    case ".jsx":
      return 2;
    case ".js":
      return 3;
    case ".json":
      return 4;
    case ".css":
      return 5;
    default:
      return 6;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatSummary(file: FileSummary): string {
  const lines: string[] = [`### ${file.path}`];

  if (file.imports.length > 0) {
    lines.push(`- Imports: ${file.imports.join(", ")}`);
  }
  if (file.exports.length > 0) {
    lines.push(`- Exports: ${file.exports.join(", ")}`);
  }
  if (file.functions.length > 0) {
    lines.push(`- Functions/Components: ${file.functions.join(", ")}`);
  }

  // If the file has no meaningful extracted info, show a minimal entry
  if (file.imports.length === 0 && file.exports.length === 0 && file.functions.length === 0) {
    lines.push("- (no exports or functions detected)");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateRepoMap(projectDir: string): Promise<string> {
  const resolvedRoot = path.resolve(projectDir);

  // 1. Walk the project to discover files
  const absolutePaths = await walkFiles(resolvedRoot);

  // 2. Sort by extension priority, then alphabetically
  absolutePaths.sort((a, b) => {
    const prioA = extensionPriority(a);
    const prioB = extensionPriority(b);
    if (prioA !== prioB) return prioA - prioB;
    return a.localeCompare(b);
  });

  // 3. Parse each file
  const summaries: FileSummary[] = [];
  for (const absPath of absolutePaths) {
    try {
      const content = await fs.readFile(absPath, "utf-8");
      const ext = path.extname(absPath).toLowerCase();
      const parsed = parseFile(content, ext);
      summaries.push({
        path: path.relative(resolvedRoot, absPath).replace(/\\/g, "/"),
        ...parsed,
      });
    } catch {
      // Skip files that cannot be read
    }
  }

  // 4. Format with truncation to stay within the character budget
  const header = "## Project Structure\n";
  let output = header;
  let truncated = false;

  for (let i = 0; i < summaries.length; i++) {
    const block = formatSummary(summaries[i]);
    const candidate = output + "\n" + block;

    if (candidate.length > MAX_OUTPUT_CHARS) {
      const remaining = summaries.length - i;
      output += `\n\n... and ${remaining} more file(s) omitted for brevity.`;
      truncated = true;
      break;
    }

    output += "\n" + block;

    // Add a blank line between entries for readability
    if (i < summaries.length - 1) {
      output += "\n";
    }
  }

  if (!truncated && summaries.length === 0) {
    output += "\n(no source files found)";
  }

  return output;
}
