import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extension = path.join(root, "dist", "extension");
const { version } = JSON.parse(readFileSync(path.join(root, "extension", "manifest.json"), "utf8"));
const output = path.join(root, "dist", `personal-vault-extension-${version}.zip`);

const build = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs")], {
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

rmSync(output, { force: true });
const zip = spawnSync("zip", ["-r", "-X", "-q", output, "."], { cwd: extension, stdio: "inherit" });
if (zip.error || zip.status !== 0) {
  console.error("Packaging needs the `zip` command (macOS and most Linux distributions ship it).");
  process.exit(1);
}
console.log(`Packaged ${path.relative(root, output)} for the Chrome Web Store`);
