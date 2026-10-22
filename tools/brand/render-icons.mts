import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launch } from "./cdp.mjs";
import { logoSvg } from "../../src/ui/logo.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const page = (size: number) =>
  `data:text/html;base64,${Buffer.from(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${logoSvg()}`,
  ).toString("base64")}`;

const browser = await launch(9371);
try {
  await browser.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  for (const size of [16, 32, 48, 128]) {
    await browser.viewport(size, size, 1);
    await browser.goto(page(size), 300);
    await browser.shot(path.join(root, "extension", "icons", `icon-${size}.png`));
  }
  await browser.viewport(128, 128, 1);
  await browser.goto(page(128), 300);
  const file = path.join(root, "tools", "brand", "email-logo.png");
  await browser.shot(file);
  const base64 = readFileSync(file).toString("base64");
  writeFileSync(
    path.join(root, "src", "worker", "email-logo.ts"),
    `export const EMAIL_LOGO_PNG_BASE64 =\n  "${base64}";\n`,
  );
} finally {
  browser.close();
}
