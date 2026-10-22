import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildImportGraph, findCycles } from "../scripts/check-cycles.ts";

const ALIASES = { "#lib/*": "./lib/*" };

let folder: string | null = null;

function fixture(files: Record<string, string>) {
  folder = mkdtempSync(path.join(tmpdir(), "7key-cycles-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.join(folder, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  }
  return findCycles(buildImportGraph(folder, Object.keys(files), ALIASES));
}

afterEach(() => {
  if (folder) {
    rmSync(folder, { recursive: true, force: true });
    folder = null;
  }
});

describe("check-cycles", () => {
  it("reports a runtime cycle through relative and aliased imports", () => {
    expect(
      fixture({
        "app/a.ts": `import { b } from "./b.js";\nexport const a = b;\n`,
        "app/b.ts": `export { c as b } from "#lib/c.js";\n`,
        "lib/c.ts": `import { a } from "../app/a.js";\nexport const c = () => a;\n`,
      }),
    ).toEqual([["app/a.ts", "app/b.ts", "lib/c.ts", "app/a.ts"]]);
  });

  it("ignores edges that only carry types", () => {
    expect(
      fixture({
        "app/a.ts": `import type { B } from "./b.js";\nexport type A = B;\nexport const a = 1;\n`,
        "app/b.ts": `import { a } from "./a.js";\nexport type B = typeof a;\nexport type { A } from "./a.js";\n`,
      }),
    ).toEqual([]);
  });

  it("counts an import whose names are all inline types, since it stays at runtime", () => {
    expect(
      fixture({
        "app/a.ts": `import { type B } from "./b.js";\nexport const a = 1 as B;\n`,
        "app/b.tsx": `import { a } from "./a.js";\nexport type B = number;\nexport const b = a;\n`,
      }),
    ).toEqual([["app/a.ts", "app/b.tsx", "app/a.ts"]]);
  });
});
