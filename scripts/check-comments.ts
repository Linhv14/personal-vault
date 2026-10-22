import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");

const SOURCE_FOLDERS = [
  "src/",
  "extension/",
  "web/",
  "cli/",
  "action/",
  "share/",
  "scripts/",
  "tools/",
  "test/",
  "e2e-browser/",
  "commercial/",
];
const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const EXCLUDED_PREFIXES = ["action/dist/", "dist/", "node_modules/"];
const ROOT_SOURCE_FILES = new Set([
  "eslint.config.mjs",
  "vitest.config.ts",
  "playwright.config.ts",
]);
const ALLOWED_COMMENTS = [
  /^#!/,
  /^\/\/\/\s*<reference\s/,
  /^\/\/\s*@vitest-environment\s/,
  /^\/[/*]\s*@ts-expect-error\b/,
  /^\/[/*]\s*eslint-disable/,
];

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function isExcluded(file: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix) || file.includes(`/${prefix}`));
}

function isSourceFile(file: string): boolean {
  if (!SOURCE_EXTENSIONS.test(file) || isExcluded(file)) {
    return false;
  }
  return ROOT_SOURCE_FILES.has(file) || SOURCE_FOLDERS.some((folder) => file.startsWith(folder));
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (/\.(ts|mts|cts)$/.test(file)) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

function sourceComments(file: string, text: string): number[] {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const seen = new Set<number>();
  const lines: number[] = [];
  const collect = (position: number) => {
    const ranges = [
      ...(ts.getLeadingCommentRanges(text, position) ?? []),
      ...(ts.getTrailingCommentRanges(text, position) ?? []),
    ];
    for (const range of ranges) {
      if (seen.has(range.pos)) {
        continue;
      }
      seen.add(range.pos);
      const comment = text.slice(range.pos, range.end);
      if (!ALLOWED_COMMENTS.some((pattern) => pattern.test(comment))) {
        lines.push(sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1);
      }
    }
  };
  const visit = (node: ts.Node) => {
    collect(node.getFullStart());
    collect(node.getEnd());
    for (const child of node.getChildren(sourceFile)) {
      visit(child);
    }
  };
  visit(sourceFile);
  return lines;
}

function lineComments(text: string, marker: string): number[] {
  return text
    .split("\n")
    .flatMap((line, index) => (line.trimStart().startsWith(marker) ? [index + 1] : []));
}

function jsonComments(text: string): number[] {
  try {
    JSON.parse(text);
    return [];
  } catch {
    return [1];
  }
}

function commentsIn(file: string): number[] {
  const text = readFileSync(path.join(root, file), "utf8");
  if (isSourceFile(file)) {
    return sourceComments(file, text);
  }
  if (/^migrations\/.*\.sql$/.test(file)) {
    return lineComments(text, "--");
  }
  if (file === "wrangler.toml" || file === "share/_headers") {
    return lineComments(text, "#");
  }
  if (/(^|\/)tsconfig[^/]*\.json$/.test(file) && !isExcluded(file)) {
    return jsonComments(text);
  }
  return [];
}

const findings = trackedFiles().flatMap((file) =>
  commentsIn(file).map((line) => `${file}:${line}`),
);

if (findings.length > 0) {
  process.stderr.write(
    `Comments are not allowed in code, config or migrations; explain decisions in docs/explanation/ instead.\n${findings.join("\n")}\n`,
  );
  process.exit(1);
}
