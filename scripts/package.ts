import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extension = path.join(root, "dist", "extension");
const { version } = JSON.parse(
  readFileSync(path.join(root, "extension", "manifest.json"), "utf8"),
) as { version: string };
const output = path.join(root, "dist", `7key-extension-${version}.zip`);
const staging = path.join(root, "dist", "store-extension");

const build = spawnSync(process.execPath, [path.join(root, "scripts", "build.ts")], {
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

rmSync(staging, { recursive: true, force: true });
cpSync(extension, staging, { recursive: true });
const manifestPath = path.join(staging, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
delete manifest.key;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

rmSync(output, { force: true });
const zip = spawnSync("zip", ["-r", "-X", "-q", output, "."], { cwd: staging, stdio: "inherit" });
if (zip.error || zip.status !== 0) {
  console.error("Packaging needs the `zip` command (macOS and most Linux distributions ship it).");
  process.exit(1);
}
rmSync(staging, { recursive: true, force: true });
console.log(`Packaged ${path.relative(root, output)} for the Chrome Web Store`);
