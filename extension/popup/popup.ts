/**
 * Popup của extension — toàn bộ UI của vault.
 *
 * Mọi thứ nằm trong popup chứ không chia việc với service worker, vì service
 * worker của MV3 bị kill sau ~30 giây không hoạt động: nhồi trạng thái vào đó chỉ
 * sinh ra những lỗi xuất hiện ngẫu nhiên. Service worker ở đây chỉ lo auto-lock.
 */

import {
  createAccount,
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  open as openSealed,
  rewrapVaultKey,
  type KdfParams,
  type SealedData,
} from "../../src/core/crypto.js";
import { toBase64 } from "../../src/core/bytes.js";
import type { Bytes } from "../../src/core/bytes.js";
import {
  generatePassphrase,
  generatePassword,
  generatePin,
  rateStrength,
  type GeneratedSecret,
} from "../../src/core/generator.js";
import { generateTotp, parseTotpInput, secondsRemaining, type TotpConfig } from "../../src/core/totp.js";
import { buildShareUrl, createShare } from "../../src/core/share.js";
import * as api from "../lib/api.js";
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  getLocal,
  getUnlocked,
  lock,
  setLocal,
  touch,
  unlock,
} from "../lib/storage.js";
import {
  decryptAll,
  importKey,
  matchingItems,
  newItemId,
  registrableDomain,
  removeItem,
  saveItem,
  searchItems,
  sync,
  type VaultItem,
} from "../lib/vault.js";

// ---------------------------------------------------------------------------
// Tiện ích DOM
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Thiếu #${id}`);
  return node as T;
};

const SCREENS = ["setup", "unlock", "list", "edit", "generator", "share", "settings"] as const;
type Screen = (typeof SCREENS)[number];

function show(screen: Screen): void {
  for (const name of SCREENS) $(`screen-${name}`).hidden = name !== screen;
}

function setError(id: string, message: string | null): void {
  const node = $(id);
  node.textContent = message ?? "";
  node.hidden = !message;
}

let toastTimer: number | undefined;
function toast(message: string): void {
  const node = $("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 1800) as unknown as number;
}

/**
 * Copy kèm tự xoá clipboard sau 30 giây.
 *
 * Clipboard là bộ nhớ dùng chung của cả máy — mọi app đang chạy đọc được, và
 * nhiều trình quản lý clipboard còn lưu lịch sử xuống đĩa.
 */
async function copy(value: string, label: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast(`Đã copy ${label} — clipboard tự xoá sau 30 giây`);
  setTimeout(async () => {
    try {
      // Chỉ xoá nếu clipboard vẫn đang chứa đúng thứ ta đặt vào; người dùng có
      // thể đã copy việc khác và xoá đi là phá việc của họ.
      if ((await navigator.clipboard.readText()) === value) {
        await navigator.clipboard.writeText("");
      }
    } catch {
      /* chưa cấp quyền đọc clipboard thì bỏ qua */
    }
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Trạng thái phiên làm việc của popup
// ---------------------------------------------------------------------------

let vaultKey: CryptoKey | null = null;
let items: VaultItem[] = [];
let tabUrl: string | undefined;
let clockSkew = 0;
/** Giữ raw vault key để đổi master password mà không bắt nhập lại lần hai. */
let vaultKeyRaw: Bytes | null = null;

/** Đồng hồ đã bù lệch so với server — TOTP phải dùng mốc này, không dùng Date.now(). */
function nowMs(): number {
  return Date.now() + clockSkew * 1000;
}

const timers = new Set<number>();
function clearTimers(): void {
  for (const timer of timers) clearInterval(timer);
  timers.clear();
}

// ---------------------------------------------------------------------------
// Khởi động
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab?.url;

  const local = await getLocal();
  clockSkew = local.clockSkew ?? 0;

  if (!local.apiUrl || !local.email) {
    show("setup");
    return;
  }

  const session = await getUnlocked();
  if (!session) {
    $("unlock-email").textContent = local.email;
    show("unlock");
    return;
  }

  await enterVault(session.vaultKeyRaw);
}

async function enterVault(rawBase64: string): Promise<void> {
  vaultKey = await importKey(rawBase64);
  items = await decryptAll(vaultKey);
  renderList();
  show("list");

  // Sync và đo lệch đồng hồ ở nền: vault phải dùng được ngay cả khi mất mạng.
  void backgroundSync();
}

async function backgroundSync(): Promise<void> {
  const status = $("sync-status");
  status.textContent = "Đang đồng bộ…";
  try {
    const changed = await sync();
    if (changed === null) {
      status.textContent = "Offline — đang xem bản đã lưu";
    } else {
      if (changed > 0 && vaultKey) {
        items = await decryptAll(vaultKey);
        renderList();
      }
      status.textContent = changed > 0 ? `Đã đồng bộ ${changed} thay đổi` : "Đã đồng bộ";
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Lỗi đồng bộ";
  }

  const skew = await api.measureClockSkew();
  if (skew !== null) {
    clockSkew = skew;
    await setLocal({ clockSkew: skew });
    const warning = $("clock-warning");
    // Lệch quá 10 giây là đã đáng cảnh báo: TOTP sẽ sai khi gần mốc đổi mã.
    if (Math.abs(skew) > 10) {
      warning.textContent = `Đồng hồ máy lệch ${skew > 0 ? "chậm" : "nhanh"} ${Math.abs(skew)} giây so với server. Mã 2FA vẫn đúng vì đã được bù, nhưng nên sửa lại đồng hồ hệ thống.`;
      warning.hidden = false;
    } else {
      warning.hidden = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Thiết lập và đăng nhập
// ---------------------------------------------------------------------------

let setupMode: "register" | "login" = "register";

$("setup-switch-login").addEventListener("click", () => {
  setupMode = setupMode === "register" ? "login" : "register";
  const form = $<HTMLFormElement>("form-setup");
  const tokenField = form.querySelector<HTMLInputElement>('[name="registrationToken"]')!;
  const confirmField = form.querySelector<HTMLInputElement>('[name="confirm"]')!;

  for (const [field, hidden] of [
    [tokenField, setupMode === "login"],
    [confirmField, setupMode === "login"],
  ] as const) {
    field.required = !hidden;
    field.closest("label")!.hidden = hidden;
  }

  form.querySelector("button.primary")!.textContent =
    setupMode === "login" ? "Đăng nhập" : "Tạo vault";
  $("setup-switch-login").textContent =
    setupMode === "login" ? "Tạo vault mới" : "Đã có account trên server này";
});

$<HTMLFormElement>("form-setup").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("setup-error", null);

  const data = new FormData(event.target as HTMLFormElement);
  const apiUrl = String(data.get("apiUrl")).trim().replace(/\/$/, "");
  const email = String(data.get("email")).trim().toLowerCase();
  const password = String(data.get("password"));

  if (setupMode === "register" && password !== String(data.get("confirm"))) {
    setError("setup-error", "Hai lần nhập master password không giống nhau");
    return;
  }

  // Xin quyền truy cập đúng domain của server, thay vì xin sẵn https://*/*.
  const granted = await chrome.permissions.request({ origins: [`${apiUrl}/*`] });
  if (!granted) {
    setError("setup-error", "Cần cấp quyền truy cập server mới dùng được");
    return;
  }

  const button = (event.target as HTMLFormElement).querySelector("button.primary")!;
  button.textContent = "Đang xử lý… (dẫn xuất khoá mất vài giây)";
  (button as HTMLButtonElement).disabled = true;

  try {
    await setLocal({ apiUrl, email });

    if (setupMode === "register") {
      const { record } = await createAccount(email, password);
      const { token } = await api.register(email, record, String(data.get("registrationToken")));
      await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
      await finishUnlock(email, password, record.kdf, record.wrappedVaultKey, token);
    } else {
      await doLogin(email, password);
    }
  } catch (error) {
    setError("setup-error", error instanceof Error ? error.message : String(error));
  } finally {
    button.textContent = setupMode === "login" ? "Đăng nhập" : "Tạo vault";
    (button as HTMLButtonElement).disabled = false;
  }
});

$<HTMLFormElement>("form-unlock").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("unlock-error", null);

  const password = String(new FormData(event.target as HTMLFormElement).get("password"));
  const button = (event.target as HTMLFormElement).querySelector("button.primary")!;
  button.textContent = "Đang mở…";
  (button as HTMLButtonElement).disabled = true;

  try {
    const { email } = await getLocal();
    await doLogin(email!, password);
  } catch (error) {
    setError("unlock-error", error instanceof Error ? error.message : String(error));
  } finally {
    button.textContent = "Mở";
    (button as HTMLButtonElement).disabled = false;
  }
});

/**
 * Mở vault, chạy được cả khi không có mạng.
 *
 * Khi online, lấy KDF params mới từ server (để đổi master password trên máy khác
 * vẫn mở được ở đây) rồi đăng nhập lấy token. Khi offline, dùng KDF params và
 * wrapped vault key đã cache — đủ để giải mã mọi thứ đã sync về.
 */
async function doLogin(email: string, password: string): Promise<void> {
  const local = await getLocal();

  let kdf: KdfParams | undefined = local.kdf;
  let wrapped: SealedData | undefined = local.wrappedVaultKey;
  let token: string | undefined;

  try {
    kdf = await api.prelogin(email);
    const masterKey = await deriveMasterKey(email, password, kdf);
    const authKey = toBase64(await deriveAuthKey(masterKey));
    const result = await api.login(email, authKey);
    token = result.token;
    wrapped = result.wrappedVaultKey;
    await setLocal({ kdf, wrappedVaultKey: wrapped });
  } catch (error) {
    // Chỉ chấp nhận đi tiếp khi lỗi là mất mạng. Sai mật khẩu (401) phải báo ngay,
    // không được âm thầm rơi về chế độ offline rồi thất bại với lý do khác.
    const offline = error instanceof api.ApiError && error.status === 0;
    if (!offline || !kdf || !wrapped) throw error;
    toast("Không có mạng — mở bản đã lưu trên máy");
  }

  await finishUnlock(email, password, kdf!, wrapped!, token);
}

async function finishUnlock(
  email: string,
  password: string,
  kdf: KdfParams,
  wrapped: SealedData,
  token: string | undefined,
): Promise<void> {
  const masterKey = await deriveMasterKey(email, password, kdf);
  const wrappingKey = await deriveWrappingKey(masterKey);

  let raw: Bytes;
  try {
    raw = await openSealed(wrappingKey, wrapped);
  } catch {
    throw new Error("Master password không đúng");
  }

  vaultKeyRaw = raw;
  await unlock(toBase64(raw), token);
  await enterVault(toBase64(raw));
}

$("unlock-reset").addEventListener("click", async () => {
  if (!confirm("Xoá cấu hình và dữ liệu đã lưu trên máy này? Vault trên server không bị ảnh hưởng.")) {
    return;
  }
  await chrome.storage.local.clear();
  await lock();
  location.reload();
});

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------

$("search").addEventListener("input", () => renderList());
$("btn-add").addEventListener("click", () => openEditor(null));
$("btn-generator").addEventListener("click", () => openGenerator());
$("btn-settings").addEventListener("click", () => openSettings());
$("btn-lock").addEventListener("click", async () => {
  await lock();
  location.reload();
});

function renderList(): void {
  clearTimers();
  void touch();

  const query = $<HTMLInputElement>("search").value;
  const visible = searchItems(items, query);
  const matched = query ? [] : matchingItems(visible, tabUrl);
  const matchedIds = new Set(matched.map((item) => item.id));

  const matchingSection = $("matching-section");
  if (matched.length > 0) {
    const domain = registrableDomain(tabUrl ?? "");
    $("matching-title").textContent = `Cho ${domain}`;
    renderInto($("matching-list"), matched);
    matchingSection.hidden = false;
  } else {
    matchingSection.hidden = true;
  }

  const rest = visible.filter((item) => !matchedIds.has(item.id));
  $("all-title").hidden = rest.length === 0;
  $("all-title").textContent = query ? `Kết quả (${rest.length})` : "Tất cả";
  renderInto($("all-list"), rest);

  $("list-empty").hidden = items.length > 0;
}

function renderInto(container: HTMLElement, list: VaultItem[]): void {
  container.replaceChildren();
  for (const item of list) container.append(renderItem(item));
}

function renderItem(item: VaultItem): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "item";

  const head = document.createElement("div");
  head.className = "item-head";

  const name = document.createElement("div");
  name.className = "item-name";
  const title = document.createElement("div");
  title.className = "item-title";
  // `textContent` ở mọi chỗ, không bao giờ `innerHTML`: nội dung item do người
  // dùng nhập, và một ghi chú chứa <img onerror> không được chạy trong popup.
  title.textContent = item.title;
  const sub = document.createElement("div");
  sub.className = "item-sub";
  sub.textContent = [item.username, item.url].filter(Boolean).join(" · ");
  name.append(title, sub);

  head.append(name);

  // Copy nhanh không cần mở item — đây là thao tác thường dùng nhất.
  if (item.password) {
    const quick = document.createElement("button");
    quick.textContent = "Copy";
    quick.title = "Copy mật khẩu";
    quick.addEventListener("click", (event) => {
      event.stopPropagation();
      void copy(item.password!, "mật khẩu");
    });
    head.append(quick);
  }

  const body = document.createElement("div");
  body.className = "item-body";
  body.hidden = true;

  head.addEventListener("click", () => {
    body.hidden = !body.hidden;
    if (!body.hidden && body.childElementCount === 0) fillItemBody(body, item);
    void touch();
  });

  wrap.append(head, body);
  return wrap;
}

function fillItemBody(body: HTMLElement, item: VaultItem): void {
  if (item.username) body.append(valueRow("Tài khoản", item.username, false));
  if (item.password) body.append(valueRow("Mật khẩu", item.password, true));
  if (item.totp) body.append(totpRow(item.totp));
  if (item.url) body.append(valueRow("Địa chỉ", item.url, false));
  if (item.note) body.append(valueRow("Ghi chú", item.note, false));

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const edit = document.createElement("button");
  edit.textContent = "Sửa";
  edit.addEventListener("click", () => openEditor(item));

  const share = document.createElement("button");
  share.textContent = "Chia sẻ";
  share.addEventListener("click", () => openShare(item));

  actions.append(edit, share);
  body.append(actions);
}

function valueRow(label: string, value: string, secret: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "item-row";

  const key = document.createElement("span");
  key.className = "k";
  key.textContent = label;

  const valueNode = document.createElement("span");
  valueNode.className = "v";
  valueNode.textContent = secret ? "•".repeat(Math.min(value.length, 16)) : value;

  row.append(key, valueNode);

  if (secret) {
    let revealed = false;
    const toggle = document.createElement("button");
    toggle.textContent = "Hiện";
    toggle.addEventListener("click", () => {
      revealed = !revealed;
      valueNode.textContent = revealed ? value : "•".repeat(Math.min(value.length, 16));
      toggle.textContent = revealed ? "Ẩn" : "Hiện";
    });
    row.append(toggle);
  }

  const copyButton = document.createElement("button");
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", () => void copy(value, label.toLowerCase()));
  row.append(copyButton);

  return row;
}

/**
 * Mã TOTP tự refresh. Không có network nào tham gia — tính tại chỗ từ secret đã
 * giải mã, đúng công thức RFC 6238 mà app 2FA trên điện thoại dùng.
 */
function totpRow(config: TotpConfig): HTMLElement {
  const period = config.period || 30;

  const row = document.createElement("div");
  row.className = "item-row";

  const key = document.createElement("span");
  key.className = "k";
  key.textContent = "Mã 2FA";

  const container = document.createElement("div");
  container.className = "totp-row v";

  const ring = createRing();
  const code = document.createElement("span");
  code.className = "totp-code";
  code.textContent = "······";
  container.append(ring.svg, code);

  const copyButton = document.createElement("button");
  copyButton.textContent = "Copy";

  let current = "";
  let lastCounter = -1;

  const tick = async (): Promise<void> => {
    const remaining = secondsRemaining(period, nowMs());
    ring.update(remaining / period);
    ring.svg.classList.toggle("urgent", remaining <= 5);

    // Chỉ tính lại khi sang chu kỳ mới, không phải mỗi giây.
    const counter = Math.floor(nowMs() / 1000 / period);
    if (counter !== lastCounter) {
      lastCounter = counter;
      try {
        current = await generateTotp(config, nowMs());
        code.textContent = current.replace(/(\d{3})(?=\d)/, "$1 ");
      } catch {
        code.textContent = "lỗi";
      }
    }
  };

  copyButton.addEventListener("click", () => current && void copy(current, "mã 2FA"));

  void tick();
  timers.add(setInterval(() => void tick(), 1000) as unknown as number);

  row.append(key, container, copyButton);
  return row;
}

function createRing(): { svg: SVGSVGElement; update: (ratio: number) => void } {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ring");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("viewBox", "0 0 22 22");

  const make = (className: string): SVGCircleElement => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", className);
    circle.setAttribute("cx", "11");
    circle.setAttribute("cy", "11");
    circle.setAttribute("r", String(radius));
    return circle;
  };

  const progress = make("progress");
  progress.setAttribute("stroke-dasharray", String(circumference));
  svg.append(make("track"), progress);

  return {
    svg,
    update: (ratio) =>
      progress.setAttribute("stroke-dashoffset", String(circumference * (1 - ratio))),
  };
}

// ---------------------------------------------------------------------------
// Thêm / sửa item
// ---------------------------------------------------------------------------

let editing: VaultItem | null = null;

function openEditor(item: VaultItem | null): void {
  clearTimers();
  editing = item;
  setError("edit-error", null);
  $("edit-totp-hint").textContent = "";

  const form = $<HTMLFormElement>("form-edit");
  form.reset();
  $("edit-title").textContent = item ? "Sửa item" : "Thêm item";
  $("edit-delete").hidden = !item;

  const set = (name: string, value: string) => {
    form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
  };

  set("title", item?.title ?? "");
  // Gợi ý sẵn domain của tab đang mở khi thêm mới — đỡ phải gõ lại.
  set("url", item?.url ?? (item ? "" : (tabUrl ? registrableDomain(tabUrl) ?? "" : "")));
  set("username", item?.username ?? "");
  set("password", item?.password ?? "");
  set("totp", item?.totp?.secret ?? "");
  set("note", item?.note ?? "");

  show("edit");
}

$("edit-back").addEventListener("click", () => {
  renderList();
  show("list");
});

$("edit-reveal").addEventListener("click", () => {
  const field = $<HTMLFormElement>("form-edit").querySelector<HTMLInputElement>('[name="password"]')!;
  field.type = field.type === "password" ? "text" : "password";
});

$("edit-generate").addEventListener("click", () => {
  const field = $<HTMLFormElement>("form-edit").querySelector<HTMLInputElement>('[name="password"]')!;
  const generated = generatePassword({ length: 20 });
  field.value = generated.value;
  field.type = "text";
  toast(`${generated.entropyBits} bit — ${rateStrength(generated.entropyBits)}`);
});

/**
 * Quét QR code 2FA từ ảnh chụp tab đang mở.
 *
 * Dùng `BarcodeDetector` có sẵn trong Chrome thay vì nhúng thư viện decode QR:
 * thư viện đó sẽ nằm trong đường đi của TOTP secret — nó thấy secret trước cả
 * bạn — nên đây là chỗ đáng tránh thêm dependency. Máy nào không hỗ trợ API này
 * thì vẫn dán tay được, đường đó luôn hoạt động.
 */
$("edit-scan").addEventListener("click", async () => {
  const hint = $("edit-totp-hint");

  if (!("BarcodeDetector" in self)) {
    hint.textContent =
      'Chrome trên máy này không có sẵn bộ giải mã QR. Hãy bấm "không quét được QR?" trên trang web để lấy chuỗi base32 rồi dán vào đây.';
    return;
  }

  hint.textContent = "Đang chụp tab và tìm QR…";
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

    const DetectorClass = (self as unknown as { BarcodeDetector: new (options: { formats: string[] }) => { detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    const codes = await new DetectorClass({ formats: ["qr_code"] }).detect(bitmap);

    const otpauth = codes.find((code) => code.rawValue.toLowerCase().startsWith("otpauth://"));
    if (!otpauth) {
      hint.textContent = codes.length
        ? "Tìm thấy QR nhưng không phải QR 2FA."
        : "Không thấy QR nào trong vùng đang hiển thị. Cuộn cho QR hiện rõ rồi thử lại.";
      return;
    }

    const form = $<HTMLFormElement>("form-edit");
    form.querySelector<HTMLInputElement>('[name="totp"]')!.value = otpauth.rawValue;
    const config = parseTotpInput(otpauth.rawValue);
    if (config.issuer && !form.querySelector<HTMLInputElement>('[name="title"]')!.value) {
      form.querySelector<HTMLInputElement>('[name="title"]')!.value = config.issuer;
    }
    hint.textContent = `Đã đọc QR${config.issuer ? ` của ${config.issuer}` : ""}. Mã thử: ${await generateTotp(config, nowMs())}`;
  } catch (error) {
    hint.textContent = `Không chụp được tab: ${error instanceof Error ? error.message : String(error)}`;
  }
});

$<HTMLFormElement>("form-edit").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("edit-error", null);

  const data = new FormData(event.target as HTMLFormElement);
  const totpRaw = String(data.get("totp")).trim();

  let totp: TotpConfig | undefined;
  if (totpRaw) {
    try {
      totp = parseTotpInput(totpRaw, String(data.get("username")) || undefined);
    } catch (error) {
      setError("edit-error", `TOTP secret không đọc được: ${error instanceof Error ? error.message : ""}`);
      return;
    }
  }

  if (!vaultKey) return;

  try {
    await saveItem(vaultKey, {
      id: editing?.id ?? newItemId(),
      createdAt: editing?.createdAt,
      title: String(data.get("title")).trim(),
      url: String(data.get("url")).trim() || undefined,
      username: String(data.get("username")).trim() || undefined,
      password: String(data.get("password")) || undefined,
      note: String(data.get("note")).trim() || undefined,
      totp,
    });
    items = await decryptAll(vaultKey);
    renderList();
    show("list");
    toast(editing ? "Đã lưu" : "Đã thêm item");
  } catch (error) {
    setError("edit-error", error instanceof Error ? error.message : String(error));
  }
});

$("edit-delete").addEventListener("click", async () => {
  if (!editing || !vaultKey) return;
  if (!confirm(`Xoá "${editing.title}"? Không khôi phục được.`)) return;

  try {
    await removeItem(editing.id);
    items = await decryptAll(vaultKey);
    renderList();
    show("list");
    toast("Đã xoá");
  } catch (error) {
    setError("edit-error", error instanceof Error ? error.message : String(error));
  }
});

// ---------------------------------------------------------------------------
// Sinh mật khẩu
// ---------------------------------------------------------------------------

type GenMode = "password" | "passphrase" | "pin";
let genMode: GenMode = "password";

function openGenerator(): void {
  clearTimers();
  show("generator");
  regenerate();
}

$("gen-back").addEventListener("click", () => {
  renderList();
  show("list");
});

for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => {
    genMode = tab.dataset.mode as GenMode;
    for (const other of document.querySelectorAll(".tab")) {
      other.classList.toggle("active", other === tab);
    }
    for (const mode of ["password", "passphrase", "pin"] as const) {
      $(`gen-options-${mode}`).hidden = mode !== genMode;
    }
    regenerate();
  });
}

for (const id of [
  "gen-length",
  "gen-upper",
  "gen-digits",
  "gen-symbols",
  "gen-unambiguous",
  "gen-words",
  "gen-capitalize",
  "gen-append-digit",
  "gen-pin",
]) {
  $(id).addEventListener("input", () => regenerate());
}

$("gen-again").addEventListener("click", () => regenerate());
$("gen-copy").addEventListener("click", () => void copy($("gen-value").textContent ?? "", "mật khẩu"));

function regenerate(): void {
  const checked = (id: string) => $<HTMLInputElement>(id).checked;
  const number = (id: string) => Number($<HTMLInputElement>(id).value);

  let result: GeneratedSecret;
  try {
    if (genMode === "password") {
      $("gen-length-out").textContent = String(number("gen-length"));
      result = generatePassword({
        length: number("gen-length"),
        uppercase: checked("gen-upper"),
        digits: checked("gen-digits"),
        symbols: checked("gen-symbols"),
        excludeAmbiguous: checked("gen-unambiguous"),
      });
    } else if (genMode === "passphrase") {
      $("gen-words-out").textContent = String(number("gen-words"));
      result = generatePassphrase({
        words: number("gen-words"),
        capitalize: checked("gen-capitalize"),
        appendDigit: checked("gen-append-digit"),
      });
    } else {
      $("gen-pin-out").textContent = String(number("gen-pin"));
      result = generatePin(number("gen-pin"));
    }
  } catch (error) {
    $("gen-value").textContent = "—";
    $("gen-entropy").textContent = error instanceof Error ? error.message : String(error);
    return;
  }

  $("gen-value").textContent = result.value;
  $("gen-entropy").textContent = `${result.entropyBits} bit — ${rateStrength(result.entropyBits)}`;
}

// ---------------------------------------------------------------------------
// Chia sẻ
// ---------------------------------------------------------------------------

let sharing: VaultItem | null = null;

function openShare(item: VaultItem): void {
  clearTimers();
  sharing = item;
  setError("share-error", null);
  $("share-result").hidden = true;
  $<HTMLFormElement>("form-share").hidden = false;
  $("share-item").textContent = `Chia sẻ "${item.title}"`;

  const totpCheckbox = $<HTMLFormElement>("form-share").querySelector<HTMLInputElement>('[name="includeTotp"]')!;
  totpCheckbox.closest("label")!.hidden = !item.totp;
  show("share");
}

$("share-back").addEventListener("click", () => {
  renderList();
  show("list");
});

$<HTMLFormElement>("form-share").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("share-error", null);
  if (!sharing) return;

  const data = new FormData(event.target as HTMLFormElement);
  const includeTotp = data.get("includeTotp") === "on";
  const passphrase = String(data.get("passphrase")).trim() || undefined;
  const maxViews = Number(data.get("maxViews"));

  try {
    const { sealed, fragment } = await createShare(
      {
        title: sharing.title,
        url: sharing.url,
        username: sharing.username,
        password: sharing.password,
        note: sharing.note,
        totp: includeTotp ? sharing.totp : undefined,
      },
      passphrase,
    );

    const ttlSeconds = Number(data.get("ttl"));
    const created = await api.createShareLink(sealed, ttlSeconds, maxViews);

    const { apiUrl } = await getLocal();
    const url = buildShareUrl(apiUrl!, created.id, fragment);

    $<HTMLTextAreaElement>("share-url").value = url;
    $("share-note").textContent = `Xem được ${maxViews} lần, hết hạn ${new Date(created.expiresAt * 1000).toLocaleString("vi-VN")}.${passphrase ? " Đừng gửi mật khẩu phụ cùng kênh với link." : ""}`;
    $<HTMLFormElement>("form-share").hidden = true;
    $("share-result").hidden = false;
  } catch (error) {
    setError("share-error", error instanceof Error ? error.message : String(error));
  }
});

$("share-copy").addEventListener("click", async () => {
  // Link chứa khoá giải mã, nên clipboard cũng tự xoá như với mật khẩu.
  await copy($<HTMLTextAreaElement>("share-url").value, "link");
});

// ---------------------------------------------------------------------------
// Cài đặt
// ---------------------------------------------------------------------------

async function openSettings(): Promise<void> {
  clearTimers();
  setError("settings-error", null);
  $("form-change-password").hidden = true;

  const local = await getLocal();
  const slider = $<HTMLInputElement>("settings-lock");
  slider.value = String(local.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES);
  $("settings-lock-out").textContent = `${slider.value} phút`;

  $("settings-info").textContent = `${local.email} · ${items.length} item · ${local.lastSync ? `đồng bộ lúc ${new Date(local.lastSync * 1000).toLocaleTimeString("vi-VN")}` : "chưa đồng bộ"}`;

  show("settings");
}

$("settings-back").addEventListener("click", () => {
  renderList();
  show("list");
});

$("settings-lock").addEventListener("input", async (event) => {
  const minutes = Number((event.target as HTMLInputElement).value);
  $("settings-lock-out").textContent = `${minutes} phút`;
  await setLocal({ autoLockMinutes: minutes });
  await touch();
});

$("settings-change-password").addEventListener("click", () => {
  $("form-change-password").hidden = !$("form-change-password").hidden;
});

$<HTMLFormElement>("form-change-password").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("settings-error", null);

  const data = new FormData(event.target as HTMLFormElement);
  const next = String(data.get("next"));
  if (next !== String(data.get("confirm"))) {
    setError("settings-error", "Hai lần nhập không giống nhau");
    return;
  }
  if (!vaultKeyRaw) {
    setError("settings-error", "Hãy khoá rồi mở lại vault trước khi đổi master password");
    return;
  }

  const local = await getLocal();

  // Xác minh mật khẩu hiện tại bằng chính wrapped vault key đang cache, không
  // cần gọi server: nếu mở được thì đúng mật khẩu.
  try {
    const masterKey = await deriveMasterKey(local.email!, String(data.get("current")), local.kdf!);
    await openSealed(await deriveWrappingKey(masterKey), local.wrappedVaultKey!);
  } catch {
    setError("settings-error", "Master password hiện tại không đúng");
    return;
  }

  try {
    const record = await rewrapVaultKey(local.email!, next, vaultKeyRaw);
    await api.changePassword(record);
    await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
    // Server đã thu hồi mọi session, kể cả của chính ta — buộc mở lại là đúng.
    await lock();
    alert("Đã đổi master password. Hãy mở lại vault bằng mật khẩu mới.");
    location.reload();
  } catch (error) {
    setError("settings-error", error instanceof Error ? error.message : String(error));
  }
});

$("settings-logout").addEventListener("click", async () => {
  if (!confirm("Đăng xuất và xoá toàn bộ dữ liệu trên máy này? Vault trên server không bị ảnh hưởng.")) {
    return;
  }
  await api.logout();
  await chrome.storage.local.clear();
  await lock();
  location.reload();
});

void boot();
