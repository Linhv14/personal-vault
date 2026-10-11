/**
 * Tạo một link share thật trên Worker đang chạy local, để kiểm tra trang `/s/:id`
 * bằng browser thật.
 *
 * Dùng:
 *   npx esbuild scripts/make-share-link.ts --bundle --platform=node --format=esm --outfile=dist/mk.mjs
 *   node dist/mk.mjs
 */

import { createAccount } from "../src/core/crypto.js";
import { buildShareUrl, createShare } from "../src/core/share.js";

const BASE = process.env.VAULT_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";

const email = `demo-${Date.now()}@example.com`;
const { record } = await createAccount(email, "mật khẩu demo rất dài", 100_000);

const registered = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Registration-Token": REGISTRATION_TOKEN },
  body: JSON.stringify({ email, ...record }),
});
if (!registered.ok) throw new Error(`Đăng ký thất bại: ${await registered.text()}`);
const { token } = (await registered.json()) as { token: string };

const { sealed, fragment } = await createShare({
  title: "Netflix của nhà",
  url: "netflix.com",
  username: "nha@example.com",
  password: "Kh0ng-Ai-Doan-Duoc-2026!",
  note: "Dùng profile thứ hai.\nĐừng đổi mật khẩu nhé.",
  totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA-1", digits: 6, period: 30 },
});

const created = await fetch(`${BASE}/api/shares`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ ...sealed, ttlSeconds: 86_400, maxViews: 5 }),
});
if (!created.ok) throw new Error(`Tạo share thất bại: ${await created.text()}`);
const { id } = (await created.json()) as { id: string };

console.log(buildShareUrl(BASE, id, fragment));
