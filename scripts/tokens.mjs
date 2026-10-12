import { readFile } from "node:fs/promises";
import path from "node:path";

export const TOKENS_MARKER = "/* @tokens */";
const TOKENS_FILE = path.resolve(import.meta.dirname, "..", "src", "ui", "tokens.css");

export function hasTokensMarker(text) {
  return text.includes(TOKENS_MARKER);
}

export async function injectTokens(text, origin) {
  if (!hasTokensMarker(text)) throw new Error(`${origin} has no ${TOKENS_MARKER} marker`);
  return text.replace(TOKENS_MARKER, await readFile(TOKENS_FILE, "utf8"));
}
