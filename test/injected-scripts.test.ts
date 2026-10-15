import { describe, expect, it } from "vitest";
import { INJECTED_SCRIPTS } from "../scripts/extension-entries.ts";
import { SCRIPTS } from "../extension/lib/autofill-permission.js";

describe("scripts injected into web pages", () => {
  it("are exactly the entries the build wraps in their own scope", () => {
    const registered = SCRIPTS.flatMap((script) => script.js ?? []).map((file) =>
      file.replace(/\.js$/, ".ts"),
    );
    expect([...registered].sort()).toEqual([...INJECTED_SCRIPTS].sort());
  });
});
