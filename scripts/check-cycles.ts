import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_FOLDERS = ["extension/", "src/", "web/", "cli/", "share/"];
const SOURCE_EXTENSIONS = /\.(ts|tsx)$/;
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export type ImportGraph = Map<string, string[]>;

function runtimeSpecifiers(file: string, text: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) {
        continue;
      }
      if (ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) {
        continue;
      }
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
  }
  return specifiers;
}

function aliasTarget(specifier: string, aliases: Record<string, string>): string | null {
  for (const [pattern, target] of Object.entries(aliases)) {
    const prefix = pattern.replace(/\*$/, "");
    if (pattern.endsWith("*") && specifier.startsWith(prefix)) {
      return target.replace(/\*$/, specifier.slice(prefix.length));
    }
    if (pattern === specifier) {
      return target;
    }
  }
  return null;
}

function resolveSpecifier(
  from: string,
  specifier: string,
  aliases: Record<string, string>,
  files: Set<string>,
): string | null {
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.posix.join(path.posix.dirname(from), specifier);
  } else if (specifier.startsWith("#")) {
    const target = aliasTarget(specifier, aliases);
    if (target === null) {
      return null;
    }
    base = path.posix.normalize(target);
  } else {
    return null;
  }
  const stems = /\.(js|jsx)$/.test(base) ? [base.replace(/\.(js|jsx)$/, ""), base] : [base];
  for (const stem of stems) {
    for (const suffix of RESOLVE_SUFFIXES) {
      if (files.has(stem + suffix)) {
        return stem + suffix;
      }
    }
  }
  return null;
}

export function buildImportGraph(
  root: string,
  files: string[],
  aliases: Record<string, string>,
): ImportGraph {
  const known = new Set(files);
  const graph: ImportGraph = new Map();
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8");
    const targets = new Set<string>();
    for (const specifier of runtimeSpecifiers(file, text)) {
      const target = resolveSpecifier(file, specifier, aliases, known);
      if (target !== null) {
        targets.add(target);
      }
    }
    graph.set(file, [...targets].sort());
  }
  return graph;
}

function stronglyConnected(graph: ImportGraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const connect = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        connect(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component);
    }
  };

  for (const node of [...graph.keys()].sort()) {
    if (!index.has(node)) {
      connect(node);
    }
  }
  return components;
}

function cycleThrough(graph: ImportGraph, members: Set<string>, start: string): string[] {
  const previous = new Map<string, string>();
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of graph.get(node) ?? []) {
      if (!members.has(next)) {
        continue;
      }
      if (next === start) {
        const cycle = [node];
        while (cycle[0] !== start) {
          cycle.unshift(previous.get(cycle[0]!)!);
        }
        return [...cycle, start];
      }
      if (!seen.has(next)) {
        seen.add(next);
        previous.set(next, node);
        queue.push(next);
      }
    }
  }
  return [start, start];
}

export function findCycles(graph: ImportGraph): string[][] {
  return stronglyConnected(graph)
    .filter(
      (component) =>
        component.length > 1 || (graph.get(component[0]!) ?? []).includes(component[0]!),
    )
    .map((component) => {
      const members = new Set(component);
      const start = [...component].sort()[0]!;
      return cycleThrough(graph, members, start);
    })
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
}

function trackedSourceFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(
      (file) =>
        SOURCE_EXTENSIONS.test(file) &&
        !file.endsWith(".d.ts") &&
        SOURCE_FOLDERS.some((folder) => file.startsWith(folder)),
    );
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    imports?: Record<string, string>;
  };
  const graph = buildImportGraph(root, trackedSourceFiles(root), manifest.imports ?? {});
  const cycles = findCycles(graph);
  if (cycles.length > 0) {
    process.stderr.write(
      `Import cycles are not allowed; move the shared piece into a lower module.\n${cycles
        .map((cycle) => cycle.join(" -> "))
        .join("\n")}\n`,
    );
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
