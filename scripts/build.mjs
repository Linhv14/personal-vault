/**
 * Builds the share page and the extension with esbuild.
 *
 * esbuild rather than a full bundler because both outputs are plain
 * framework-free JavaScript; Vite or webpack here would only add something else
 * to maintain.
 */

import { build } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outPublic = path.join(root, "dist", "public");
const outExtension = path.join(root, "dist", "extension");

const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  // Source maps only in dev builds; a release should not ship a map pointing
  // back at the source.
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "info",
};

async function buildSharePage() {
  await mkdir(outPublic, { recursive: true });
  await build({
    ...common,
    entryPoints: [path.join(root, "share", "main.ts")],
    outfile: path.join(outPublic, "share.js"),
  });
  await cp(path.join(root, "share", "index.html"), path.join(outPublic, "share.html"));
}

async function buildExtension() {
  const source = path.join(root, "extension");
  if (!existsSync(path.join(source, "manifest.json"))) {
    console.log("Skipping the extension: no extension/manifest.json");
    return;
  }

  await mkdir(outExtension, { recursive: true });

  const entryPoints = ["popup/popup.ts", "background.ts"]
    .map((file) => path.join(source, file))
    .filter((file) => existsSync(file));

  await build({
    ...common,
    entryPoints,
    outdir: outExtension,
    outbase: source,
    // An MV3 service worker runs in its own module scope; code splitting would
    // emit shared chunks the manifest cannot declare.
    splitting: false,
  });

  for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(source, path.join(entry.parentPath, entry.name));
    if (relative.endsWith(".ts")) continue;
    const target = path.join(outExtension, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(source, relative), target);
  }
}

// `wrangler dev` holds a handle on dist/public while running, so rmdir reports
// EBUSY on Windows. In that case clear the contents instead.
try {
  await rm(path.join(root, "dist"), { recursive: true, force: true });
} catch (error) {
  if (error.code !== "EBUSY" && error.code !== "EPERM") throw error;
  for (const dir of [outPublic, outExtension]) {
    if (!existsSync(dir)) continue;
    for (const entry of await readdir(dir)) {
      await rm(path.join(dir, entry), { recursive: true, force: true });
    }
  }
}

await buildSharePage();
await buildExtension();
console.log(dev ? "Dev build complete." : "Build complete.");
