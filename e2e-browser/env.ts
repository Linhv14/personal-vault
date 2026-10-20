import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const WORKER_PORT = 8789;
export const SITE_PORT = 8792;
export const API_URL = `http://127.0.0.1:${WORKER_PORT}`;
export const SITE_URL = `http://localhost:${SITE_PORT}`;
export const REGISTRATION_TOKEN = "token-dev-local";
export const PERSIST_DIR = path.join(ROOT, ".wrangler", "e2e-browser-state");
export const ARTIFACTS_DIR = path.join(ROOT, "e2e-browser", ".artifacts");
export const EXTENSION_SOURCE = path.join(ROOT, "dist", "extension");
export const EXTENSION_DIR = path.join(ARTIFACTS_DIR, "extension");
