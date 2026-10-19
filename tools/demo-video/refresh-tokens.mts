import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toBase64 } from "../../src/core/bytes.js";
import { deriveAuthKey, deriveMasterKey } from "../../src/core/crypto.js";

const B = "http://127.0.0.1:8787";
const file = path.join(import.meta.dirname, "accounts.local.json");
const accounts = JSON.parse(readFileSync(file, "utf8")) as Record<
  string,
  { email: string; password: string; token: string }
>;

async function post<T>(route: string, body: unknown): Promise<T> {
  const response = await fetch(B + route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

for (const account of Object.values(accounts)) {
  const { kdf } = await post<{ kdf: Parameters<typeof deriveMasterKey>[2] }>("/api/auth/prelogin", {
    email: account.email,
  });
  const authKey = toBase64(
    await deriveAuthKey(await deriveMasterKey(account.email, account.password, kdf)),
  );
  account.token = (
    await post<{ token: string }>("/api/auth/login", { email: account.email, authKey })
  ).token;
  console.log("refreshed", account.email);
}
writeFileSync(file, JSON.stringify(accounts, null, 2));
