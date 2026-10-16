/**
 * Builds the share page and the extension with esbuild.
 *
 * esbuild rather than a full bundler because both outputs are plain
 * framework-free JavaScript; Vite or webpack here would only add something else
 * to maintain.
 */

import { build, type BuildOptions } from "esbuild";
import { hasTokensMarker, injectTokens } from "./tokens.ts";
import { renderMarkdown } from "./markdown.ts";
import { localizePage } from "./localize-page.ts";
import { EXTENSION_PAGES, INJECTED_SCRIPTS } from "./extension-entries.ts";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const common: BuildOptions = {
  define: { __VAULT_DEFAULT_SERVER__: JSON.stringify(deployedServerUrl()) },
  bundle: true,
  format: "esm",
  target: "es2022",
  // Source maps only in dev builds; a release should not ship a map pointing
  // back at the source.
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "info",
  jsx: "automatic",
  jsxImportSource: "preact",
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
  const source = Buffer.from(outputFiles[0]?.text ?? "").toString("base64");
  const { LOGO_SVG } = (await import(`data:text/javascript;base64,${source}`)) as {
    LOGO_SVG: string;
  };
  return LOGO_SVG;
}

async function replaceAsync(
  text: string,
  pattern: RegExp,
  replace: (...match: string[]) => Promise<string>,
): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(last, match.index), await replace(...match));
    last = match.index + match[0].length;
  }
  return parts.join("") + text.slice(last);
}

async function copyPage(from: string, to: string): Promise<void> {
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
  const security = await readFile(path.join(root, "share", "security.html"), "utf8");
  const filled = await replaceAsync(security, /<!-- markdown:([^ ]+) -->/g, async (_, file = "") =>
    renderMarkdown(await readFile(path.join(root, file), "utf8")),
  );
  await writeFile(
    path.join(outPublic, "security.html"),
    await injectTokens(filled, "share/security.html"),
  );
  const landing = await readFile(path.join(root, "share", "landing.html"), "utf8");
  for (const [lang, file] of [
    ["en", "index.html"],
    ["vi", "vi.html"],
  ] as const) {
    await writeFile(
      path.join(outPublic, file),
      await injectTokens(localizePage(landing, lang), "share/landing.html"),
    );
  }
  await cp(path.join(root, "share", "assets"), path.join(outPublic, "assets"), { recursive: true });
  await writeFile(path.join(outPublic, "favicon.svg"), await logoSvg());
}

async function fingerprinted(out: string, name: string, text: string): Promise<string> {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 10);
  const [base, extension] = name.split(".");
  const file = `assets/${base}-${hash}.${extension}`;
  await writeFile(path.join(out, file), text);
  return file;
}

async function buildDashboard() {
  const source = path.join(root, "web");
  const out = path.join(outPublic, "app");
  await mkdir(path.join(out, "assets"), { recursive: true });
  const { outputFiles } = await build({
    ...common,
    entryPoints: [path.join(source, "main.tsx")],
    outfile: path.join(out, "app.js"),
    write: false,
  });
  const assets: Record<string, string> = {
    "app.js": await fingerprinted(out, "app.js", outputFiles?.[0]?.text ?? ""),
  };
  for (const [name, from] of [
    ["tokens.css", path.join(root, "src", "ui", "tokens.css")],
    ["console.css", path.join(root, "extension", "console", "console.css")],
    ["web.css", path.join(source, "web.css")],
  ] as const) {
    assets[name] = await fingerprinted(out, name, await readFile(from, "utf8"));
  }
  const page = (await readFile(path.join(source, "index.html"), "utf8")).replace(
    /(href|src)="(app\.js|tokens\.css|console\.css|web\.css)"/g,
    (_: string, attribute: string, name: string) => `${attribute}="${assets[name]}"`,
  );
  await writeFile(path.join(out, "index.html"), page);
}

async function buildCli() {
  const node: BuildOptions = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    minify: false,
    logLevel: "info",
  };
  await build({
    ...node,
    entryPoints: [path.join(root, "cli", "bin.ts")],
    outfile: path.join(root, "dist", "cli", "7key.mjs"),
    banner: { js: "#!/usr/bin/env node" },
  });
  await build({
    ...node,
    entryPoints: [path.join(root, "action", "main.ts")],
    outfile: path.join(root, "action", "dist", "index.mjs"),
  });
}

async function buildExtension() {
  const source = path.join(root, "extension");
  if (!existsSync(path.join(source, "manifest.json"))) {
    console.log("Skipping the extension: no extension/manifest.json");
    return;
  }

  await mkdir(outExtension, { recursive: true });

  const entries = (files: readonly string[]) =>
    files.map((file) => path.join(source, file)).filter((file) => existsSync(file));

  await build({
    ...common,
    entryPoints: entries(EXTENSION_PAGES),
    outdir: outExtension,
    outbase: source,
    // An MV3 service worker runs in its own module scope; code splitting would
    // emit shared chunks the manifest cannot declare.
    splitting: false,
  });
  await build({
    ...common,
    format: "iife",
    entryPoints: entries(INJECTED_SCRIPTS),
    outdir: outExtension,
    outbase: source,
  });

  for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(source, path.join(entry.parentPath, entry.name));
    if (/\.tsx?$/.test(relative)) continue;
    const target = path.join(outExtension, relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (/\.(css|html)$/.test(relative)) {
      await copyPage(path.join(source, relative), target);
    } else {
      await cp(path.join(source, relative), target);
    }
  }
}

async function copyConsoleTokens() {
  const target = path.join(outExtension, "console", "tokens.css");
  if (!existsSync(path.dirname(target))) return;
  await cp(path.join(root, "src", "ui", "tokens.css"), target);
}

async function packageForDownload() {
  if (!existsSync(outExtension)) return;
  const target = path.join(outPublic, "download", "7key-extension.zip");
  await mkdir(path.dirname(target), { recursive: true });
  const zip = spawnSync("zip", ["-r", "-X", "-q", target, "."], { cwd: outExtension });
  if (zip.error || zip.status !== 0) {
    console.warn("Skipping the extension download: the `zip` command is not available.");
  }
}

/**
 * Clean only this script's own outputs, never all of dist/, which also holds
 * the packaged extension zips.
 *
 * `wrangler dev` keeps a handle on dist/public while running, which makes rmdir
 * fail with EBUSY on Windows; in that case clear the contents instead.
 */
async function clean(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EBUSY" && code !== "EPERM") throw error;
    for (const entry of await readdir(dir)) {
      await rm(path.join(dir, entry), { recursive: true, force: true });
    }
  }
}

await clean(outPublic);
await clean(outExtension);

await buildSharePage();
await buildDashboard();
await buildCli();
await buildExtension();
await copyConsoleTokens();
await packageForDownload();
console.log(dev ? "Dev build complete." : "Build complete.");
