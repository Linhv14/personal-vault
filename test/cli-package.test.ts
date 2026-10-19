import { describe, expect, it } from "vitest";
import { formula, packageJson } from "../scripts/cli-package.js";

describe("CLI packages", () => {
  it("publishes the 7key binary to npm with only the bundled file", () => {
    const manifest = JSON.parse(packageJson("1.4.0"));
    expect(manifest).toMatchObject({
      name: "7key",
      version: "1.4.0",
      bin: { "7key": "7key.mjs" },
      files: ["7key.mjs", "README.md", "LICENSE"],
      engines: { node: ">=20" },
      license: "MIT",
    });
    expect(manifest.dependencies).toBeUndefined();
  });

  it("builds the Homebrew formula from the npm tarball and its checksum", () => {
    const text = formula("1.4.0", "ab".repeat(32));
    expect(text).toContain('url "https://registry.npmjs.org/7key/-/7key-1.4.0.tgz"');
    expect(text).toContain(`sha256 "${"ab".repeat(32)}"`);
    expect(text).toContain('depends_on "node"');
    expect(text).toMatch(/^class Sevenkey < Formula$/m);
  });
});
