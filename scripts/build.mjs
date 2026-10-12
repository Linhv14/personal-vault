/**
 * Builds the share page and the extension with esbuild.
 *
 * esbuild rather than a full bundler because both outputs are plain
 * framework-free JavaScript; Vite or webpack here would only add something else
 * to maintain.
 */

import { build } from "esbuild";
import { hasTokensMarker, injectTokens } from "./tokens.mjs";
import { localizePage } from "./localize-page.mjs";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outPublic = path.join(root, "dist", "public");
const outExtension = path.join(root, "dist", "extension");

const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

/**
 * The Worker URL of the last deployment, baked into the extension so a fresh
 * install does not ask the user to retype the address of their own server.
 * Empty when the project has never been deployed from this checkout.
 */
function deployedServerUrl() {
  const state = path.join(root, ".cf-state.json");
  if (!existsSync(state)) return "";
  try {
    return JSON.parse(readFileSync(state, "utf8")).workerUrl ?? "";
  } catch {
    return "";
  }
}

const common = {
  define: { __VAULT_DEFAULT_SERVER__: JSON.stringify(deployedServerUrl()) },
  bundle: true,
  format: "esm",
  target: "es2022",
  // Source maps only in dev builds; a release should not ship a map pointing
  // back at the source.
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "info",
  loader: { ".css": "text" },
};

async function logoSvg() {
  const { outputFiles } = await build({
    entryPoints: [path.join(root, "src", "ui", "logo.ts")],
    bundle: true,
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const source = Buffer.from(outputFiles[0].text).toString("base64");
  const { LOGO_SVG } = await import(`data:text/javascript;base64,${source}`);
  return LOGO_SVG;
}

async function copyPage(from, to) {
  const text = await readFile(from, "utf8");
  await writeFile(to, hasTokensMarker(text) ? await injectTokens(text, from) : text);
}

async function buildSharePage() {
  await mkdir(outPublic, { recursive: true });
  await build({
    ...common,
    entryPoints: [path.join(root, "share", "main.ts")],
    outfile: path.join(outPublic, "share.js"),
  });
  await copyPage(path.join(root, "share", "index.html"), path.join(outPublic, "share.html"));
  await cp(path.join(root, "share", "_headers"), path.join(outPublic, "_headers"));
  await copyPage(path.join(root, "share", "privacy.html"), path.join(outPublic, "privacy.html"));
  const landing = await readFile(path.join(root, "share", "landing.html"), "utf8");
  for (const [lang, file] of [
    ["en", "index.html"],
    ["vi", "vi.html"],
  ]) {
    await writeFile(
      path.join(outPublic, file),
      await injectTokens(localizePage(landing, lang), "share/landing.html"),
    );
  }
  await cp(path.join(root, "share", "assets"), path.join(outPublic, "assets"), { recursive: true });
  await writeFile(path.join(outPublic, "favicon.svg"), await logoSvg());
}

async function buildExtension() {
  const source = path.join(root, "extension");
  if (!existsSync(path.join(source, "manifest.json"))) {
    console.log("Skipping the extension: no extension/manifest.json");
    return;
  }

  await mkdir(outExtension, { recursive: true });

  const entryPoints = [
    "popup/popup.ts",
    "background.ts",
    "offscreen/offscreen.ts",
    "content/content.ts",
  ]
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
    if (/\.(css|html)$/.test(relative)) {
      await copyPage(path.join(source, relative), target);
    } else {
      await cp(path.join(source, relative), target);
    }
  }
}

async function packageForDownload() {
  if (!existsSync(outExtension)) return;
  const target = path.join(outPublic, "download", "1pw-extension.zip");
  await mkdir(path.dirname(target), { recursive: true });
  const zip = spawnSync("zip", ["-r", "-X", "-q", target, "."], { cwd: outExtension });
  if (zip.error || zip.status !== 0) {
    console.warn("Skipping the extension download: the `zip` command is not available.");
  }
}

/**
 * Clean only this script's own outputs, never all of dist/: other tooling
 * (scripts/preview.mjs) writes siblings there, and wiping them makes a running
 * preview server start returning 404 the moment someone runs a build.
 *
 * `wrangler dev` keeps a handle on dist/public while running, which makes rmdir
 * fail with EBUSY on Windows; in that case clear the contents instead.
 */
async function clean(dir) {
  if (!existsSync(dir)) return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "EBUSY" && error.code !== "EPERM") throw error;
    for (const entry of await readdir(dir)) {
      await rm(path.join(dir, entry), { recursive: true, force: true });
    }
  }
}

await clean(outPublic);
await clean(outExtension);

await buildSharePage();
await buildExtension();
await packageForDownload();
console.log(dev ? "Dev build complete." : "Build complete.");
