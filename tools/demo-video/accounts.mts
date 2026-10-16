import { writeFileSync } from "node:fs";
import path from "node:path";
import { createVaultKey, rewrapVaultKey } from "../../src/core/crypto.js";
import { toBase64 } from "../../src/core/bytes.js";

const B = "http://127.0.0.1:8787";
const registrationToken = process.env.REGISTRATION_TOKEN ?? "token-dev-local";

async function register(label: string) {
  const email = `${label}-${Date.now()}@acme.test`;
  const password = `pw ${label}`;
  const raw = createVaultKey();
  const record = await rewrapVaultKey(email, password, raw, 100000);
  const r = await fetch(`${B}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-registration-token": registrationToken },
    body: JSON.stringify({ email, ...record }),
  });
  if (!r.ok) throw new Error(`register ${label}: ${r.status} ${await r.text()}`);
  const body = (await r.json()) as { token: string; accountId: string };
  return {
    email,
    password,
    token: body.token,
    accountId: body.accountId,
    raw: toBase64(raw),
    record,
  };
}

const accounts = {
  owner: await register("linh"),
  member: await register("an"),
  admin: await register("binh"),
};
writeFileSync(
  path.join(import.meta.dirname, "accounts.local.json"),
  JSON.stringify(accounts, null, 2),
);
console.log(
  Object.values(accounts)
    .map((a) => a.email)
    .join("\n"),
);
