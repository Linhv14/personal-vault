import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const read = (name) => {
  const file = path.join(here, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};

export const ACCOUNTS = read("accounts.local.json") ?? {};
export const DEMO = read("demo.local.json") ?? {};
export const SITE = path.join(here, "site");
export const OUT = path.join(here, "out");
export const BASE = "http://127.0.0.1:8793";
