// @vitest-environment happy-dom

/**
 * Smoke test cho popup extension: chạy popup.html thật, với `chrome.*` và server
 * giả, rồi đi qua các luồng chính.
 *
 * Mục đích không phải kiểm tra từng nút, mà bắt những lỗi mà typecheck không
 * thấy được: thiếu id trong HTML, sai thứ tự màn hình, và — quan trọng nhất —
 * khoá hay plaintext bị ghi nhầm vào `storage.local` (vùng nằm trên đĩa).
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const EMAIL = "test@example.com";
const PASSWORD = "mật khẩu chủ dài cho test";
const API_URL = "https://vault.test";
const REGISTRATION_TOKEN = "token-test";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

// ---------------------------------------------------------------------------
// chrome.* giả
// ---------------------------------------------------------------------------

const localArea = new Map<string, unknown>();
const sessionArea = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return Object.fromEntries(store);
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) store.set(key, value);
    }),
    clear: vi.fn(async () => store.clear()),
  };
}

const chromeMock = {
  storage: { local: area(localArea), session: area(sessionArea) },
  tabs: {
    query: vi.fn(async () => [{ url: "https://github.com/settings" }]),
    captureVisibleTab: vi.fn(),
  },
  permissions: { request: vi.fn(async () => true) },
  alarms: { create: vi.fn(async () => {}), onAlarm: { addListener: vi.fn() } },
  runtime: { onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
};

// ---------------------------------------------------------------------------
// Server giả — giữ đúng hợp đồng của Worker, kể cả việc chỉ nhận ciphertext
// ---------------------------------------------------------------------------

interface StoredAccount {
  kdf: unknown;
  authKey: string;
  wrappedVaultKey: unknown;
}

const server = {
  account: null as StoredAccount | null,
  items: new Map<string, { ciphertext: string; nonce: string; updatedAt: number }>(),
  shares: new Map<string, unknown>(),
  /** Mọi body đã nhận — dùng để khẳng định server không bao giờ thấy plaintext. */
  received: [] as string[],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, any>) : {};
  if (init?.body) server.received.push(String(init.body));

  const now = Math.floor(Date.now() / 1000);

  if (url.pathname === "/api/auth/register") {
    const headers = new Headers(init?.headers);
    if (headers.get("X-Registration-Token") !== REGISTRATION_TOKEN) {
      return json({ error: "Token đăng ký không đúng" }, 403);
    }
    server.account = {
      kdf: body.kdf,
      authKey: body.authKey,
      wrappedVaultKey: body.wrappedVaultKey,
    };
    return json({ accountId: "acc-1", token: "token-phien", expiresAt: now + 3600 }, 201);
  }

  if (url.pathname === "/api/auth/prelogin") {
    return json({ kdf: server.account?.kdf ?? { type: "pbkdf2-sha256", iterations: 600000, salt: "AAAA" } });
  }

  if (url.pathname === "/api/auth/login") {
    if (!server.account || body.authKey !== server.account.authKey) {
      return json({ error: "Email hoặc master password không đúng" }, 401);
    }
    return json({
      token: "token-phien",
      expiresAt: now + 3600,
      wrappedVaultKey: server.account.wrappedVaultKey,
    });
  }

  if (url.pathname === "/api/time") return json({ serverTime: now });

  if (url.pathname === "/api/items" && method === "GET") {
    return json({
      serverTime: now,
      items: [...server.items.entries()].map(([id, row]) => ({
        id,
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        updatedAt: row.updatedAt,
        deletedAt: null,
      })),
    });
  }

  if (url.pathname.startsWith("/api/items/") && method === "PUT") {
    const id = url.pathname.split("/").pop()!;
    server.items.set(id, { ciphertext: body.ciphertext, nonce: body.nonce, updatedAt: now });
    return json({ id, updatedAt: now });
  }

  if (url.pathname === "/api/shares" && method === "POST") {
    const id = "share-1";
    server.shares.set(id, body);
    return json({ id, expiresAt: now + 86400, maxViews: body.maxViews }, 201);
  }

  return json({ error: `Không có endpoint ${url.pathname}` }, 404);
});

// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Thiếu #${id} trong popup.html`);
  return node as T;
}

function visibleScreen(): string | null {
  for (const section of document.querySelectorAll("section[id^='screen-']")) {
    if (!(section as HTMLElement).hidden) return section.id;
  }
  return null;
}

function setField(form: HTMLFormElement, name: string, value: string): void {
  form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
}

/** Chờ cho tới khi điều kiện đúng — các luồng đều có await ở giữa. */
async function waitFor(check: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Hết thời gian chờ: ${label} (màn hình đang hiện: ${visibleScreen()})`);
}

describe("popup extension", () => {
  beforeAll(async () => {
    const html = readFileSync(
      path.resolve(import.meta.dirname, "../extension/popup/popup.html"),
      "utf8",
    );
    // Bỏ thẻ script: ta import module TS trực tiếp để vitest transform được.
    document.body.innerHTML = html
      .replace(/[\s\S]*<body>/, "")
      .replace(/<\/body>[\s\S]*/, "")
      .replace(/<script[\s\S]*?<\/script>/g, "");

    vi.stubGlobal("chrome", chromeMock);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", () => true);
    vi.stubGlobal("alert", () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {}),
        readText: vi.fn(async () => ""),
      },
    });

    await import("../extension/popup/popup.js");
  });

  it("chưa cấu hình thì hiện màn hình thiết lập", async () => {
    await waitFor(() => visibleScreen() === "screen-setup", "màn hình thiết lập");
  });

  it("tạo vault xong thì vào được danh sách", async () => {
    const form = el<HTMLFormElement>("form-setup");
    setField(form, "apiUrl", API_URL);
    setField(form, "email", EMAIL);
    setField(form, "registrationToken", REGISTRATION_TOKEN);
    setField(form, "password", PASSWORD);
    setField(form, "confirm", PASSWORD);

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    // Dẫn xuất khoá là 600.000 vòng PBKDF2, chạy hai lần — cho nó thời gian.
    await waitFor(() => visibleScreen() === "screen-list", "màn hình danh sách", 60_000);
    expect(server.account).not.toBeNull();
  });

  it("xin quyền đúng domain của server, không phải https://*/*", async () => {
    // Nếu chỗ này xin sẵn mọi domain thì extension có quyền đọc được nhiều hơn
    // mức cần thiết, dù nó không dùng tới.
    expect(chromeMock.permissions.request).toHaveBeenCalledWith({
      origins: [`${API_URL}/*`],
    });
  });

  it("vault key nằm trong storage.session, KHÔNG nằm trong storage.local", () => {
    // Bất biến quan trọng nhất của extension: storage.local nằm trên đĩa dạng rõ.
    expect(sessionArea.get("vaultKeyRaw")).toBeTypeOf("string");
    expect(localArea.has("vaultKeyRaw")).toBe(false);

    const localDump = JSON.stringify(Object.fromEntries(localArea));
    expect(localDump).not.toContain(PASSWORD);
    expect(localDump).not.toContain(sessionArea.get("vaultKeyRaw"));
    // Token phiên cũng là thứ truy cập được ciphertext, nên cũng chỉ ở session.
    expect(localArea.has("token")).toBe(false);
    expect(sessionArea.get("token")).toBe("token-phien");
  });

  it("lưu item có TOTP, và server chỉ nhận ciphertext", async () => {
    el("btn-add").dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(() => visibleScreen() === "screen-edit", "màn hình sửa item");

    const form = el<HTMLFormElement>("form-edit");
    setField(form, "title", "GitHub");
    setField(form, "url", "github.com");
    setField(form, "username", "nguoidung@example.com");
    setField(form, "password", "mật-khẩu-bí-mật-123");
    setField(form, "totp", TOTP_SECRET);

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => visibleScreen() === "screen-list", "quay về danh sách sau khi lưu");

    expect(server.items.size).toBe(1);

    // Không một chữ nào của plaintext được phép xuất hiện trong thứ đã gửi đi.
    const sent = server.received.join("\n");
    expect(sent).not.toContain("GitHub");
    expect(sent).not.toContain("github.com");
    expect(sent).not.toContain("mật-khẩu-bí-mật-123");
    expect(sent).not.toContain(TOTP_SECRET);
  });

  it("item hiện trong mục khớp domain của tab đang mở", async () => {
    // Tab giả đang ở https://github.com/settings, item có url github.com.
    await waitFor(
      () => !el("matching-section").hidden,
      "mục gợi ý theo domain",
    );
    expect(el("matching-title").textContent).toContain("github.com");
    expect(el("matching-list").textContent).toContain("GitHub");
  });

  it("mở item ra thì hiện mã TOTP 6 số", async () => {
    const head = el("matching-list").querySelector<HTMLElement>(".item-head")!;
    head.dispatchEvent(new Event("click", { bubbles: true }));

    await waitFor(
      () => /\d{3} \d{3}/.test(el("matching-list").querySelector(".totp-code")?.textContent ?? ""),
      "mã TOTP hiện ra",
    );

    const code = el("matching-list").querySelector(".totp-code")!.textContent!.replace(" ", "");
    // So với mã tính độc lập từ cùng secret — nếu lệch thì UI đang dùng sai secret
    // hoặc sai mốc thời gian.
    const { generateTotp } = await import("../src/core/totp.js");
    expect(code).toBe(await generateTotp({ secret: TOTP_SECRET }));
  });

  it("tạo được link share, và khoá không đi lên server", async () => {
    const shareButton = [...el("matching-list").querySelectorAll("button")].find(
      (button) => button.textContent === "Chia sẻ",
    )!;
    shareButton.dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(() => visibleScreen() === "screen-share", "màn hình chia sẻ");

    el<HTMLFormElement>("form-share").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => !el("share-result").hidden, "link share được tạo");

    const url = el<HTMLTextAreaElement>("share-url").value;
    expect(url).toMatch(/^https:\/\/vault\.test\/s\/share-1#[A-Za-z0-9_-]+$/);

    // Phần sau dấu # là khoá giải mã. Nó không được có trong bất cứ request nào.
    const fragment = url.split("#")[1]!;
    expect(server.received.join("\n")).not.toContain(fragment);
  });

  it("khoá ngay thì xoá sạch storage.session", async () => {
    el("btn-lock").dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(() => sessionArea.size === 0, "session bị xoá sau khi khoá");
    expect(localArea.has("items")).toBe(true); // cache ciphertext vẫn còn để dùng offline
  });
});
