import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ACCOUNTS, SITE } from "./config.mjs";

const here = import.meta.dirname;
const popup = path.join(here, "../../dist/extension/popup");
rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
for (const name of readdirSync(path.join(here, "static"))) {
  cpSync(path.join(here, "static", name), path.join(SITE, name));
}
for (const name of ["main.js", "popup.css"]) cpSync(path.join(popup, name), path.join(SITE, name));
cpSync(path.join(here, "../../dist/public/favicon.svg"), path.join(SITE, "logo.svg"));
cpSync(path.join(here, "../../dist/public/mark.svg"), path.join(SITE, "mark.svg"));
const accounts = Object.fromEntries(
  Object.entries(ACCOUNTS).map(([role, { password: _password, ...rest }]) => [role, rest]),
);
const template = readFileSync(path.join(here, "static/popup.html"), "utf8");
writeFileSync(
  path.join(SITE, "popup.html"),
  template.replace("__ACCOUNTS__", JSON.stringify(accounts)),
);
console.log(SITE);
