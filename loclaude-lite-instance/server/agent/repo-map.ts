import fs from "fs/promises";
import path from "path";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";

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

/** Extensions that ts-morph can parse via AST. */
const AST_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

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
// AST-based file parsing (ts-morph)
// ---------------------------------------------------------------------------

function extractImportsAST(sourceFile: SourceFile): string[] {
  const imports: string[] = [];

  // Regular import declarations: import X from 'mod', import { X } from 'mod'
  for (const decl of sourceFile.getImportDeclarations()) {
    imports.push(decl.getModuleSpecifierValue());
  }

  // Dynamic imports: import('mod')
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = callExpr.getExpression();
    if (expr.getKind() === SyntaxKind.ImportKeyword) {
      const args = callExpr.getArguments();
      if (args.length > 0 && args[0].getKind() === SyntaxKind.StringLiteral) {
        imports.push(args[0].getText().replace(/['"]/g, ""));
      }
    }
  }

  return [...new Set(imports)];
}

function extractExportsAST(sourceFile: SourceFile): string[] {
  const exports: string[] = [];

  // Export declarations: export { X, Y }
  for (const exportDecl of sourceFile.getExportDeclarations()) {
    for (const namedExport of exportDecl.getNamedExports()) {
      exports.push(namedExport.getName());
    }
  }

  // Export assignments: export default X / export = X
  for (const exportAssign of sourceFile.getExportAssignments()) {
    const expr = exportAssign.getExpression();
    const text = expr.getText();
    // If it's a simple identifier, use it; otherwise label as "default"
    if (/^\w+$/.test(text)) {
      exports.push(`${text} (default)`);
    } else {
      exports.push("(default)");
    }
  }

  // Exported functions
  for (const func of sourceFile.getFunctions()) {
    if (func.isExported()) {
      const name = func.getName();
      if (name) {
        if (func.isDefaultExport()) {
          exports.push(`${name} (default)`);
        } else {
          exports.push(name);
        }
      }
    }
  }

  // Exported classes
  for (const cls of sourceFile.getClasses()) {
    if (cls.isExported()) {
      const name = cls.getName();
      if (name) {
        if (cls.isDefaultExport()) {
          exports.push(`${name} (default)`);
        } else {
          exports.push(name);
        }
      }
    }
  }

  // Exported variable statements: export const X = ..., export let Y = ...
  for (const varStmt of sourceFile.getVariableStatements()) {
    if (varStmt.isExported()) {
      for (const decl of varStmt.getDeclarations()) {
        exports.push(decl.getName());
      }
    }
  }

  // Exported interfaces
  for (const iface of sourceFile.getInterfaces()) {
    if (iface.isExported()) {
      exports.push(iface.getName());
    }
  }

  // Exported type aliases
  for (const typeAlias of sourceFile.getTypeAliases()) {
    if (typeAlias.isExported()) {
      exports.push(typeAlias.getName());
    }
  }

  // Exported enums
  for (const enumDecl of sourceFile.getEnums()) {
    if (enumDecl.isExported()) {
      exports.push(enumDecl.getName());
    }
  }

  return [...new Set(exports)];
}

function extractFunctionsAST(sourceFile: SourceFile): string[] {
  const names: string[] = [];

  // Top-level function declarations
  for (const func of sourceFile.getFunctions()) {
    const name = func.getName();
    if (name) names.push(name);
  }

  // Top-level class declarations
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (name) names.push(name);
  }

  // Top-level const/let/var declarations that are arrow functions or function expressions
  for (const varStmt of sourceFile.getVariableStatements()) {
    for (const decl of varStmt.getDeclarations()) {
      const initializer = decl.getInitializer();
      if (!initializer) continue;

      const kind = initializer.getKind();
      if (
        kind === SyntaxKind.ArrowFunction ||
        kind === SyntaxKind.FunctionExpression
      ) {
        names.push(decl.getName());
      } else if (kind === SyntaxKind.CallExpression) {
        // React patterns: React.memo(...), React.forwardRef(...), styled.div(...)
        const text = initializer.getText();
        if (
          text.startsWith("React.memo") ||
          text.startsWith("React.forwardRef") ||
          text.startsWith("styled.") ||
          text.startsWith("memo(") ||
          text.startsWith("forwardRef(")
        ) {
          names.push(decl.getName());
        }
      }
    }
  }

  return [...new Set(names)];
}

function parseFileAST(absPath: string, content: string): Omit<FileSummary, "path"> {
  // Create a fresh project per file to avoid memory accumulation
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      jsx: 2, // React
    },
  });

  const sourceFile = project.createSourceFile(path.basename(absPath), content);

  try {
    const result = {
      imports: extractImportsAST(sourceFile),
      exports: extractExportsAST(sourceFile),
      functions: extractFunctionsAST(sourceFile),
    };
    return result;
  } finally {
    // Clean up to free memory
    project.removeSourceFile(sourceFile);
  }
}

// ---------------------------------------------------------------------------
// Regex-based fallback parsing (for .css, .json, or when AST fails)
// ---------------------------------------------------------------------------

function extractImportsRegex(content: string): string[] {
  const imports: string[] = [];

  const importFromRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importFromRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  return [...new Set(imports)];
}

function extractExportsRegex(content: string): string[] {
  const exports: string[] = [];

  const defaultFuncRegex =
    /export\s+default\s+(?:function|class)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = defaultFuncRegex.exec(content)) !== null) {
    exports.push(`${match[1]} (default)`);
  }

  const defaultIdRegex = /export\s+default\s+([A-Z]\w*)\s*;/g;
  while ((match = defaultIdRegex.exec(content)) !== null) {
    exports.push(`${match[1]} (default)`);
  }

  const namedExportRegex =
    /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  return [...new Set(exports)];
}

function extractFunctionsRegex(content: string): string[] {
  const names: string[] = [];

  const funcDeclRegex = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = funcDeclRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  const arrowRegex =
    /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:(?:\([^)]*\)|[^=])\s*=>|function)/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  const reactPatternRegex =
    /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:React\.(?:memo|forwardRef)|styled\.\w+)/g;
  while ((match = reactPatternRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  const classRegex = /(?:^|\n)\s*(?:export\s+)?class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    names.push(match[1]);
  }

  return [...new Set(names)];
}

function parseFileRegex(content: string): Omit<FileSummary, "path"> {
  return {
    imports: extractImportsRegex(content),
    exports: extractExportsRegex(content),
    functions: extractFunctionsRegex(content),
  };
}

// ---------------------------------------------------------------------------
// Sorting / prioritisation
// ---------------------------------------------------------------------------

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

  // 3. Parse each file — use AST for TS/JS, regex fallback for CSS/JSON or on error
  const summaries: FileSummary[] = [];
  for (const absPath of absolutePaths) {
    try {
      const content = await fs.readFile(absPath, "utf-8");
      const ext = path.extname(absPath).toLowerCase();

      let parsed: Omit<FileSummary, "path">;

      if (AST_EXTENSIONS.has(ext)) {
        try {
          parsed = parseFileAST(absPath, content);
        } catch {
          // Fall back to regex if AST parsing fails
          parsed = parseFileRegex(content);
        }
      } else if (ext === ".css" || ext === ".json") {
        // Non-script files — just show as-is, no parsing
        parsed = { imports: [], exports: [], functions: [] };
      } else {
        parsed = parseFileRegex(content);
      }

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
