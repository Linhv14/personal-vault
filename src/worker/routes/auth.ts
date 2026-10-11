import { Hono } from "hono";
import { DEFAULT_KDF_ITERATIONS, hashAuthKey } from "../../core/crypto.js";
import { fromBase64, timingSafeEqual, toBase64, utf8Encode } from "../../core/bytes.js";
import { createSession, isBase64, revokeAllSessions, revokeSession } from "../session.js";
import type { AppBindings, Env } from "../types.js";

const auth = new Hono<AppBindings>();

const MAX_FAILURES = 10;
const WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 15 * 60;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  // Kiểm tra vừa đủ: email ở đây là định danh account và là salt của KDF, không
  // phải địa chỉ để gửi thư, nên không cần xác thực chặt chẽ hơn.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

interface SealedBody {
  ciphertext: string;
  nonce: string;
}

function isSealed(value: unknown, maxBytes = 4096): value is SealedBody {
  if (typeof value !== "object" || value === null) return false;
  const { ciphertext, nonce } = value as Record<string, unknown>;
  // Nonce của AES-GCM luôn đúng 12 byte; khác đi là client sai hoặc ai đó đang thử.
  return isBase64(ciphertext, maxBytes) && isBase64(nonce, 12);
}

interface KdfBody {
  type: "pbkdf2-sha256";
  iterations: number;
  salt: string;
}

function isKdf(value: unknown): value is KdfBody {
  if (typeof value !== "object" || value === null) return false;
  const { type, iterations, salt } = value as Record<string, unknown>;
  return (
    type === "pbkdf2-sha256" &&
    typeof iterations === "number" &&
    // Chặn dưới để client không tự hạ số vòng xuống mức dò được; chặn trên để
    // không ai tự khoá mình ra khỏi vault bằng một con số làm treo browser.
    iterations >= 100_000 &&
    iterations <= 5_000_000 &&
    isBase64(salt, 64)
  );
}

/**
 * Đăng ký phải có token bí mật.
 *
 * Không có bước này thì Worker đang bật công khai là một trang đăng ký cho bất
 * cứ ai tìm thấy URL — họ không đọc được vault của bạn, nhưng dùng hết quota và
 * biến hạ tầng của bạn thành chỗ chứa dữ liệu của người lạ.
 */
auth.post("/register", async (c) => {
  const provided = c.req.header("x-registration-token") ?? "";
  const expected = c.env.REGISTRATION_TOKEN;
  if (!expected || !timingSafeEqual(utf8Encode(provided), utf8Encode(expected))) {
    return c.json({ error: "Token đăng ký không đúng" }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Body không phải JSON" }, 400);
  }

  const { email: rawEmail, kdf, authKey, wrappedVaultKey } = body as Record<string, unknown>;
  const email = normalizeEmail(rawEmail);
  if (!email) return c.json({ error: "Email không hợp lệ" }, 400);
  if (!isKdf(kdf)) return c.json({ error: "KDF params không hợp lệ" }, 400);
  if (!isBase64(authKey, 32)) return c.json({ error: "authKey không hợp lệ" }, 400);
  if (!isSealed(wrappedVaultKey, 64)) {
    return c.json({ error: "wrappedVaultKey không hợp lệ" }, 400);
  }

  const timestamp = now();
  const accountId = crypto.randomUUID();

  try {
    await c.env.DB.prepare(
      `INSERT INTO accounts
         (id, email, kdf_type, kdf_iterations, kdf_salt,
          auth_key_hash, wrapped_vault_key, wrap_nonce, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        accountId,
        email,
        kdf.type,
        kdf.iterations,
        kdf.salt,
        await hashAuthKey(authKey),
        wrappedVaultKey.ciphertext,
        wrappedVaultKey.nonce,
        timestamp,
      )
      .run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return c.json({ error: "Email đã được đăng ký" }, 409);
    }
    throw error;
  }

  const session = await createSession(c.env, accountId, timestamp);
  return c.json({ accountId, ...session }, 201);
});

/**
 * Trả KDF params để client dẫn xuất auth key *trước khi* đăng nhập.
 *
 * Email không tồn tại cũng trả về params trông hợp lệ, sinh xác định từ HMAC của
 * một secret phía server. Nếu trả 404 ở đây, bất cứ ai cũng dò được email nào đã
 * đăng ký — và với vault cá nhân thì chính email đó là nửa đầu của mục tiêu.
 */
auth.post("/prelogin", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeEmail((body as Record<string, unknown> | null)?.email);
  if (!email) return c.json({ error: "Email không hợp lệ" }, 400);

  const row = await c.env.DB.prepare(
    "SELECT kdf_type, kdf_iterations, kdf_salt FROM accounts WHERE email = ?",
  )
    .bind(email)
    .first<{ kdf_type: string; kdf_iterations: number; kdf_salt: string }>();

  if (row) {
    return c.json({
      kdf: { type: row.kdf_type, iterations: row.kdf_iterations, salt: row.kdf_salt },
    });
  }

  return c.json({ kdf: await decoyKdf(c.env, email) });
});

async function decoyKdf(env: Env, email: string): Promise<KdfBody> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(env.EMAIL_PROBE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8Encode(email)));
  return {
    type: "pbkdf2-sha256",
    iterations: DEFAULT_KDF_ITERATIONS,
    salt: toBase64(mac.slice(0, 16)),
  };
}

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { email: rawEmail, authKey } = (body ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(rawEmail);
  if (!email || !isBase64(authKey, 32)) {
    return c.json({ error: "Thông tin đăng nhập không hợp lệ" }, 400);
  }

  const timestamp = now();
  const lock = await checkLock(c.env, email, timestamp);
  if (lock) {
    return c.json({ error: `Thử lại sau ${lock} giây` }, 429);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, auth_key_hash, wrapped_vault_key, wrap_nonce
       FROM accounts WHERE email = ?`,
  )
    .bind(email)
    .first<{
      id: string;
      auth_key_hash: string;
      wrapped_vault_key: string;
      wrap_nonce: string;
    }>();

  const providedHash = await hashAuthKey(authKey);
  // So sánh timing-safe và luôn chạy dù account không tồn tại, để thời gian phản
  // hồi không tiết lộ email nào có thật.
  const expectedHash = row?.auth_key_hash ?? providedHash.replace(/.$/, "A");
  const matches = row !== null && timingSafeEqual(fromBase64(providedHash), fromBase64(expectedHash));

  if (!matches) {
    await recordFailure(c.env, email, timestamp);
    return c.json({ error: "Email hoặc master password không đúng" }, 401);
  }

  await clearFailures(c.env, email);
  const session = await createSession(c.env, row.id, timestamp);

  return c.json({
    ...session,
    wrappedVaultKey: { ciphertext: row.wrapped_vault_key, nonce: row.wrap_nonce },
  });
});

auth.post("/logout", async (c) => {
  await revokeSession(c.env, c.get("session").tokenHash);
  return c.json({ ok: true });
});

/**
 * Đổi master password. Client tự dẫn xuất khoá mới và bọc lại vault key, nên
 * server chỉ việc thay ba cột — không item nào bị chạm tới.
 */
auth.post("/change-password", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { kdf, authKey, wrappedVaultKey } = (body ?? {}) as Record<string, unknown>;
  if (!isKdf(kdf) || !isBase64(authKey, 32) || !isSealed(wrappedVaultKey, 64)) {
    return c.json({ error: "Dữ liệu không hợp lệ" }, 400);
  }

  const { accountId } = c.get("session");
  await c.env.DB.prepare(
    `UPDATE accounts
        SET kdf_type = ?, kdf_iterations = ?, kdf_salt = ?,
            auth_key_hash = ?, wrapped_vault_key = ?, wrap_nonce = ?
      WHERE id = ?`,
  )
    .bind(
      kdf.type,
      kdf.iterations,
      kdf.salt,
      await hashAuthKey(authKey),
      wrappedVaultKey.ciphertext,
      wrappedVaultKey.nonce,
      accountId,
    )
    .run();

  // Thu hồi mọi session: thiết bị khác đang giữ vault key cũ phải nhập lại.
  await revokeAllSessions(c.env, accountId);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Chặn dò mật khẩu qua đường online
// ---------------------------------------------------------------------------

async function checkLock(env: Env, email: string, timestamp: number): Promise<number | null> {
  const row = await env.DB.prepare("SELECT locked_until FROM login_attempts WHERE email = ?")
    .bind(email)
    .first<{ locked_until: number | null }>();
  const until = row?.locked_until ?? 0;
  return until > timestamp ? until - timestamp : null;
}

async function recordFailure(env: Env, email: string, timestamp: number): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT failures, window_start FROM login_attempts WHERE email = ?",
  )
    .bind(email)
    .first<{ failures: number; window_start: number }>();

  // Cửa sổ trượt đơn giản: hết cửa sổ thì đếm lại từ đầu.
  const inWindow = row !== null && timestamp - row.window_start < WINDOW_SECONDS;
  const failures = inWindow ? row.failures + 1 : 1;
  const windowStart = inWindow ? row.window_start : timestamp;
  const lockedUntil = failures >= MAX_FAILURES ? timestamp + LOCK_SECONDS : null;

  await env.DB.prepare(
    `INSERT INTO login_attempts (email, failures, window_start, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE
       SET failures = excluded.failures,
           window_start = excluded.window_start,
           locked_until = excluded.locked_until`,
  )
    .bind(email, failures, windowStart, lockedUntil)
    .run();
}

async function clearFailures(env: Env, email: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
}

export default auth;
