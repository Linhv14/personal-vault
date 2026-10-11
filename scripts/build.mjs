/**
 * Build trang share và extension.
 *
 * Dùng esbuild thay vì một bundler đầy đủ vì cả hai đầu ra đều là JS thuần không
 * framework — thêm Vite/webpack vào đây chỉ là thêm thứ phải bảo trì.
 */

import { build } from "esbuild";
import { cp, mkdir, rm, readdir } from "node:fs/promises";
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
  // Sourcemap chỉ ở bản dev: bản production không nên kèm map trỏ về source.
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
    console.log("Bỏ qua extension: chưa có extension/manifest.json");
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
    // Service worker của MV3 chạy ở module scope riêng; splitting sẽ sinh chunk
    // chung mà manifest không khai báo được, nên tắt hẳn.
    splitting: false,
  });

  // Copy mọi tài sản tĩnh: manifest, HTML, CSS, icon.
  for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(source, path.join(entry.parentPath, entry.name));
    if (relative.endsWith(".ts")) continue;
    const target = path.join(outExtension, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(source, relative), target);
  }
}

await rm(path.join(root, "dist"), { recursive: true, force: true });
await buildSharePage();
await buildExtension();
console.log(dev ? "Build dev xong." : "Build xong.");
