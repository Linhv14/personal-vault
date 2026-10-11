/**
 * Test end-to-end chạy thật qua Worker + D1 local.
 *
 * Mặc định bị bỏ qua. Để chạy:
 *   npm run build:dev
 *   npx wrangler d1 migrations apply vault --local
 *   npx wrangler dev            (cửa sổ khác)
 *   VAULT_E2E=1 npx vitest run test/e2e.test.ts
 *
 * Mục đích không phải kiểm tra từng endpoint, mà kiểm tra bất biến quan trọng
 * nhất của cả hệ thống: đi hết một vòng đời thật mà server không bao giờ thấy
 * plaintext.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  createAccount,
  openJson,
  sealJson,
  unlockVault,
  type AccountCryptoRecord,
} from "../src/core/crypto.js";
import { createShare, openShare } from "../src/core/share.js";
import { generateTotp } from "../src/core/totp.js";
import { generatePassword } from "../src/core/generator.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
// Số vòng thấp để test nhanh; server chỉ ràng buộc tối thiểu 100.000.
const ITERATIONS = 100_000;

const email = `e2e-${Date.now()}@example.com`;
const masterPassword = "mật khẩu chủ cho test e2e 2026";

const enabled = process.env.VAULT_E2E === "1";

async function api(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);

  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe.skipIf(!enabled)("vòng đời thật qua Worker + D1", () => {
  let record: AccountCryptoRecord;
  let vaultKey: CryptoKey;
  let token: string;

  beforeAll(async () => {
    const created = await createAccount(email, masterPassword, ITERATIONS);
    record = created.record;
    vaultKey = created.vaultKey;
  });

  it("từ chối đăng ký khi không có token đăng ký", async () => {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, ...record }),
    });
    expect(result.status).toBe(403);
  });

  it("đăng ký được với token đúng", async () => {
    const result = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email, ...record }),
    });
    expect(result.status).toBe(201);
    expect(result.body.token).toBeTruthy();
    token = result.body.token;
  });

  it("đăng ký lại cùng email bị từ chối", async () => {
    const result = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email, ...record }),
    });
    expect(result.status).toBe(409);
  });

  it("prelogin không tiết lộ email nào đã đăng ký", async () => {
    // Đây là bất biến chống dò email: cả hai phản hồi phải trông giống nhau.
    const known = await api("/api/auth/prelogin", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    const unknown = await api("/api/auth/prelogin", {
      method: "POST",
      body: JSON.stringify({ email: `không-tồn-tại-${Date.now()}@example.com` }),
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(Object.keys(unknown.body.kdf).sort()).toEqual(Object.keys(known.body.kdf).sort());
    expect(unknown.body.kdf.type).toBe(known.body.kdf.type);
  });

  it("đăng nhập bằng master password đúng, và mở được vault key", async () => {
    const prelogin = await api("/api/auth/prelogin", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    const derived = await unlockVault(email, masterPassword, {
      kdf: prelogin.body.kdf,
      wrappedVaultKey: record.wrappedVaultKey,
    });

    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, authKey: derived.authKey }),
    });

    expect(login.status).toBe(200);
    // Server trả về wrapped vault key; chỉ client mở được nó.
    const reopened = await unlockVault(email, masterPassword, {
      kdf: prelogin.body.kdf,
      wrappedVaultKey: login.body.wrappedVaultKey,
    });
    expect(reopened.vaultKeyRaw).toEqual(derived.vaultKeyRaw);
    token = login.body.token;
  });

  it("master password sai bị từ chối", async () => {
    const created = await createAccount(email, "sai bét", ITERATIONS);
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, authKey: created.record.authKey }),
    });
    expect(result.status).toBe(401);
  });

  it("không có token thì không đọc được item", async () => {
    expect((await api("/api/items")).status).toBe(401);
    // Token giả phải là ASCII: header HTTP là ByteString, ký tự có dấu bị `fetch`
    // chặn ngay ở client nên request không bao giờ tới Worker.
    expect((await api("/api/items", { token: "khong-phai-token-that" })).status).toBe(401);
  });

  const itemId = crypto.randomUUID();
  const itemPlain = {
    title: "Ngân hàng ACB",
    url: "https://online.acb.com.vn",
    username: "nguoidung@example.com",
    password: generatePassword({ length: 24 }).value,
    totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA-1" as const, digits: 6, period: 30 },
  };

  it("lưu và sync lại được item, server chỉ thấy ciphertext", async () => {
    const sealed = await sealJson(vaultKey, itemPlain);

    const put = await api(`/api/items/${itemId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(sealed),
    });
    expect(put.status).toBe(200);

    const list = await api("/api/items?since=0", { token });
    expect(list.status).toBe(200);

    const row = list.body.items.find((i: any) => i.id === itemId);
    expect(row).toBeTruthy();

    // Bất biến cốt lõi: không có chữ nào của plaintext xuất hiện trong phản hồi.
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain("Ngân hàng ACB");
    expect(raw).not.toContain("acb.com.vn");
    expect(raw).not.toContain(itemPlain.password);
    expect(raw).not.toContain("JBSWY3DPEHPK3PXP");

    // Nhưng client mở ra đúng nguyên bản.
    expect(await openJson(vaultKey, { ciphertext: row.ciphertext, nonce: row.nonce })).toEqual(
      itemPlain,
    );
  });

  it("sync delta chỉ trả item thay đổi sau mốc `since`", async () => {
    const list = await api("/api/items?since=0", { token });
    const after = await api(`/api/items?since=${list.body.serverTime}`, { token });
    expect(after.body.items).toHaveLength(0);
  });

  it("xoá trả về tombstone chứ không mất dấu", async () => {
    const del = await api(`/api/items/${itemId}`, { method: "DELETE", token });
    expect(del.status).toBe(200);

    const list = await api("/api/items?since=0", { token });
    const row = list.body.items.find((i: any) => i.id === itemId);
    // Thiết bị offline cần thấy tombstone này, nếu không nó sẽ đẩy item trở lại.
    expect(row.deletedAt).toBeGreaterThan(0);
    expect(row.ciphertext).toBeNull();
  });

  it("item của người khác không ghi đè được", async () => {
    const other = await createAccount(`khac-${Date.now()}@example.com`, "mật khẩu khác", ITERATIONS);
    const registered = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email: `khac-${Date.now()}@example.com`, ...other.record }),
    });

    const sealed = await sealJson(other.vaultKey, { title: "cố ghi đè" });
    const put = await api(`/api/items/${itemId}`, {
      method: "PUT",
      token: registered.body.token,
      body: JSON.stringify(sealed),
    });
    expect(put.status).toBe(403);
  });

  describe("link share", () => {
    it("người nhận giải mã được và tính ra mã TOTP đúng", async () => {
      const { sealed, fragment } = await createShare({
        title: itemPlain.title,
        username: itemPlain.username,
        password: itemPlain.password,
        totp: itemPlain.totp,
      });

      const created = await api("/api/shares", {
        method: "POST",
        token,
        body: JSON.stringify({ ...sealed, ttlSeconds: 3600, maxViews: 2 }),
      });
      expect(created.status).toBe(201);

      // Người nhận không có token — đây là điểm chính của tính năng.
      const fetched = await api(`/api/shares/${created.body.id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.viewsLeft).toBe(1);

      const payload = await openShare(fragment, fetched.body);
      expect(payload.password).toBe(itemPlain.password);

      // Mã TOTP tính ở phía người nhận phải khớp mã tính từ secret gốc.
      const at = Date.now();
      expect(await generateTotp(payload.totp!, at)).toBe(await generateTotp(itemPlain.totp, at));
    });

    it("hết lượt xem thì link chết", async () => {
      const { sealed, fragment } = await createShare({ password: "chỉ xem một lần" });
      const created = await api("/api/shares", {
        method: "POST",
        token,
        body: JSON.stringify({ ...sealed, ttlSeconds: 600, maxViews: 1 }),
      });

      const first = await api(`/api/shares/${created.body.id}`);
      expect(first.status).toBe(200);
      expect((await openShare(fragment, first.body)).password).toBe("chỉ xem một lần");

      const second = await api(`/api/shares/${created.body.id}`);
      expect(second.status).toBe(404);
    });

    it("tạo link cần đăng nhập, đọc link thì không", async () => {
      const { sealed } = await createShare({ password: "x" });
      const result = await api("/api/shares", {
        method: "POST",
        body: JSON.stringify({ ...sealed, ttlSeconds: 600, maxViews: 1 }),
      });
      expect(result.status).toBe(401);
    });

    it("từ chối ttl và maxViews ngoài giới hạn", async () => {
      const { sealed } = await createShare({ password: "x" });
      for (const body of [
        { ...sealed, ttlSeconds: 10, maxViews: 1 },
        { ...sealed, ttlSeconds: 999_999_999, maxViews: 1 },
        { ...sealed, ttlSeconds: 600, maxViews: 0 },
        { ...sealed, ttlSeconds: 600, maxViews: 1000 },
      ]) {
        expect((await api("/api/shares", { method: "POST", token, body: JSON.stringify(body) })).status).toBe(400);
      }
    });

    it("link cần mật khẩu phụ: ciphertext tải về vẫn vô dụng nếu không có nó", async () => {
      const { sealed, fragment } = await createShare({ password: "hai lớp" }, "cà phê sữa");
      const created = await api("/api/shares", {
        method: "POST",
        token,
        body: JSON.stringify({ ...sealed, ttlSeconds: 600, maxViews: 1 }),
      });

      const fetched = await api(`/api/shares/${created.body.id}`);
      await expect(openShare(fragment, fetched.body, "sai rồi")).rejects.toThrow(/không đúng/);
      // Cùng ciphertext đó, đúng mật khẩu phụ thì mở được — không tốn lượt xem thêm.
      expect((await openShare(fragment, fetched.body, "cà phê sữa")).password).toBe("hai lớp");
    });
  });

  it("logout làm token hết tác dụng", async () => {
    expect((await api("/api/auth/logout", { method: "POST", token })).status).toBe(200);
    expect((await api("/api/items", { token })).status).toBe(401);
  });

  it("/api/time trả mốc thời gian để đo lệch đồng hồ", async () => {
    const result = await api("/api/time");
    expect(result.status).toBe(200);
    expect(Math.abs(result.body.serverTime - Math.floor(Date.now() / 1000))).toBeLessThan(60);
  });
});
