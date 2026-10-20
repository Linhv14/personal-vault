import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { API_URL, EXTENSION_DIR, EXTENSION_SOURCE } from "./env.ts";

export default function globalSetup(): void {
  if (!existsSync(path.join(EXTENSION_SOURCE, "manifest.json"))) {
    throw new Error("dist/extension is missing: run `npm run build` or `npm run test:browser`");
  }
  rmSync(EXTENSION_DIR, { recursive: true, force: true });
  mkdirSync(path.dirname(EXTENSION_DIR), { recursive: true });
  cpSync(EXTENSION_SOURCE, EXTENSION_DIR, { recursive: true });

  const manifestPath = path.join(EXTENSION_DIR, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    content_security_policy: { extension_pages: string };
    host_permissions?: string[];
    permissions: string[];
  };
  manifest.content_security_policy.extension_pages =
    manifest.content_security_policy.extension_pages.replace(
      "connect-src https:",
      `connect-src https: ${API_URL}`,
    );
  manifest.host_permissions = ["https://*/*", "http://*/*"];
  manifest.permissions = [...manifest.permissions, "clipboardRead"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
