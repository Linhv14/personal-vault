/**
 * Serves the popup as an ordinary web page for design review.
 *
 * The HTML is derived from `extension/popup/popup.html` at build time rather
 * than copied, so the preview cannot drift from what ships.
 *
 *   node scripts/preview.mjs            http://127.0.0.1:8788
 *   ?screen=setup | ?screen=unlock      review the locked-out states
 *   ?locale=vi                          review a translation
 */

import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "preview");
const port = Number(process.env.PORT ?? 8788);

function deployedServerUrl() {
  const state = path.join(root, ".cf-state.json");
  if (!existsSync(state)) return "";
  try {
    return JSON.parse(readFileSync(state, "utf8")).workerUrl ?? "";
  } catch {
    return "";
  }
}

await mkdir(out, { recursive: true });

await build({
  entryPoints: [path.join(root, "preview", "preview.ts")],
  outfile: path.join(out, "preview.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: "inline",
  logLevel: "info",
  // Same substitution the shipped build makes, so the preview shows what ships.
  define: { __VAULT_DEFAULT_SERVER__: JSON.stringify(deployedServerUrl()) },
});

const html = await readFile(path.join(root, "extension", "popup", "popup.html"), "utf8");
await writeFile(path.join(out, "index.html"), html.replace("popup.js", "preview.js"));
await cp(path.join(root, "extension", "popup", "popup.css"), path.join(out, "popup.css"));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const name = url.pathname === "/" ? "index.html" : path.basename(url.pathname);
  try {
    const body = await readFile(path.join(out, name));
    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(name)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Preview on http://127.0.0.1:${port}`));
