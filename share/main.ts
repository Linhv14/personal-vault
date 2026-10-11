/**
 * Trang xem link share. Chạy hoàn toàn ở client.
 *
 * Hai quy tắc chi phối thứ tự mọi thao tác dưới đây:
 *
 * 1. Khoá nằm trong `location.hash`, và fragment không bao giờ được gửi lên
 *    server. Không log nó, không đưa vào bất kỳ request nào.
 * 2. Mỗi lần GET /api/shares/:id là tiêu một lượt xem. Nên nếu link cần mật khẩu
 *    phụ thì phải hỏi TRƯỚC khi fetch — hỏi sau là đốt lượt xem của người dùng
 *    mỗi lần họ nhập sai.
 */

import { fragmentNeedsPassphrase, openShare, type SharePayload } from "../src/core/share.js";
import { generateTotp, secondsRemaining, TOTP_DEFAULTS } from "../src/core/totp.js";

interface ShareResponse {
  ciphertext: string;
  nonce: string;
  expiresAt: number;
  viewsLeft: number;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Thiếu phần tử #${id}`);
  return node as T;
};

const states = {
  loading: el("state-loading"),
  passphrase: el("state-passphrase"),
  error: el("state-error"),
  content: el("state-content"),
};

function show(name: keyof typeof states): void {
  for (const [key, node] of Object.entries(states)) node.hidden = key !== name;
}

function fail(message: string): void {
  el("error-message").textContent = message;
  show("error");
}

const shareId = location.pathname.split("/").filter(Boolean).pop() ?? "";
const fragment = location.hash;

async function main(): Promise<void> {
  if (!shareId || !fragment || fragment === "#") {
    fail("Link thiếu khoá giải mã. Có thể nó đã bị cắt ngắn khi gửi — hãy nhờ người gửi gửi lại nguyên vẹn.");
    return;
  }

  if (fragmentNeedsPassphrase(fragment)) {
    show("passphrase");
    el("passphrase").focus();
    el<HTMLFormElement>("passphrase-form").addEventListener("submit", onPassphraseSubmit);
    return;
  }

  await load();
}

async function onPassphraseSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const input = el<HTMLInputElement>("passphrase");
  const errorNode = el("passphrase-error");
  errorNode.hidden = true;

  // Chỉ fetch một lần rồi giữ lại phản hồi: nếu nhập sai mật khẩu phụ, ta thử lại
  // trên ciphertext đã tải về chứ không gọi API lần nữa, nên không tốn lượt xem.
  if (!cached) {
    show("loading");
    try {
      cached = await fetchShare();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  try {
    render(await openShare(fragment, cached, input.value));
  } catch (error) {
    show("passphrase");
    errorNode.textContent = error instanceof Error ? error.message : String(error);
    errorNode.hidden = false;
    input.select();
  }
}

let cached: ShareResponse | null = null;

async function fetchShare(): Promise<ShareResponse> {
  const response = await fetch(`/api/shares/${encodeURIComponent(shareId)}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Server trả về lỗi ${response.status}`);
  }
  return (await response.json()) as ShareResponse;
}

async function load(): Promise<void> {
  show("loading");
  try {
    cached = await fetchShare();
    render(await openShare(fragment, cached));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function render(payload: SharePayload): void {
  el("title").textContent = payload.title?.trim() || "Thông tin được chia sẻ";

  const parts: string[] = [];
  if (payload.url) parts.push(payload.url);
  if (cached) {
    const minutes = Math.max(0, Math.round((cached.expiresAt * 1000 - Date.now()) / 60000));
    parts.push(minutes >= 60 ? `hết hạn sau ~${Math.round(minutes / 60)} giờ` : `hết hạn sau ~${minutes} phút`);
  }
  el("meta").textContent = parts.join(" · ");

  const fields = el("fields");
  fields.replaceChildren();

  if (payload.username) fields.append(textField("Tên đăng nhập", payload.username));
  if (payload.password) fields.append(textField("Mật khẩu", payload.password, true));
  if (payload.totp) fields.append(totpField(payload.totp));
  if (payload.note) fields.append(noteField(payload.note));

  el("warning").textContent = cached?.viewsLeft
    ? `Link còn ${cached.viewsLeft} lượt xem. Đừng đóng tab trước khi lưu lại thông tin cần dùng.`
    : "Đây là lượt xem cuối cùng — tải lại trang sẽ không mở được nữa. Hãy lưu lại ngay thông tin bạn cần.";

  show("content");
}

function field(label: string): { wrap: HTMLElement; row: HTMLElement } {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const labelNode = document.createElement("div");
  labelNode.className = "label";
  labelNode.textContent = label;
  const row = document.createElement("div");
  row.className = "row";
  wrap.append(labelNode, row);
  return { wrap, row };
}

function textField(label: string, value: string, secret = false): HTMLElement {
  const { wrap, row } = field(label);

  const valueNode = document.createElement("div");
  valueNode.className = secret ? "value hidden" : "value";
  // `textContent`, không bao giờ `innerHTML`: nội dung này do người gửi nhập và
  // ta không muốn một ghi chú chứa <script> chạy được trên trang.
  valueNode.textContent = secret ? "•".repeat(Math.min(value.length, 20)) : value;

  row.append(valueNode);

  if (secret) {
    let revealed = false;
    const toggle = document.createElement("button");
    toggle.textContent = "Hiện";
    toggle.addEventListener("click", () => {
      revealed = !revealed;
      valueNode.textContent = revealed ? value : "•".repeat(Math.min(value.length, 20));
      valueNode.className = revealed ? "value" : "value hidden";
      toggle.textContent = revealed ? "Ẩn" : "Hiện";
    });
    row.append(toggle);
  }

  row.append(copyButton(value));
  return wrap;
}

function noteField(value: string): HTMLElement {
  const { wrap, row } = field("Ghi chú");
  const valueNode = document.createElement("div");
  valueNode.className = "value note";
  valueNode.textContent = value;
  row.append(valueNode, copyButton(value));
  return wrap;
}

/**
 * Mã TOTP tự refresh. Không có network nào tham gia: mã được tính tại chỗ từ
 * secret vừa giải mã, đúng công thức RFC 6238 mà app 2FA trên điện thoại dùng.
 */
function totpField(config: NonNullable<SharePayload["totp"]>): HTMLElement {
  const period = config.period || TOTP_DEFAULTS.period;
  const { wrap, row } = field(`Mã 2FA${config.issuer ? ` · ${config.issuer}` : ""}`);

  const container = document.createElement("div");
  container.className = "totp";

  const codeNode = document.createElement("div");
  codeNode.className = "code";
  codeNode.textContent = "······";

  const ring = createRing();
  container.append(ring.svg, codeNode);
  row.append(container);

  const copy = copyButton("");
  row.append(copy.element);

  let lastCounter = -1;

  const tick = async (): Promise<void> => {
    const remaining = secondsRemaining(period);
    ring.update(remaining / period);
    ring.svg.classList.toggle("urgent", remaining <= 5);

    // Chỉ tính lại khi sang chu kỳ mới, thay vì mỗi giây — tiết kiệm và tránh
    // nhấp nháy số khi phép HMAC hoàn thành không đúng nhịp.
    const counter = Math.floor(Date.now() / 1000 / period);
    if (counter !== lastCounter) {
      lastCounter = counter;
      try {
        const code = await generateTotp(config);
        codeNode.textContent = code.replace(/(\d{3})(?=\d)/, "$1 ");
        copy.setValue(code);
      } catch {
        codeNode.textContent = "lỗi";
      }
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), 1000);
  // Tab bị đóng thì dừng — và cũng để secret không bị giữ sống không cần thiết.
  addEventListener("pagehide", () => clearInterval(timer));

  return wrap;
}

function createRing(): { svg: SVGSVGElement; update: (ratio: number) => void } {
  const radius = 11;
  const circumference = 2 * Math.PI * radius;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ring");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("viewBox", "0 0 28 28");

  const make = (className: string): SVGCircleElement => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", className);
    circle.setAttribute("cx", "14");
    circle.setAttribute("cy", "14");
    circle.setAttribute("r", String(radius));
    return circle;
  };

  const track = make("track");
  const progress = make("progress");
  progress.setAttribute("stroke-dasharray", String(circumference));
  svg.append(track, progress);

  return {
    svg,
    update: (ratio) =>
      progress.setAttribute("stroke-dashoffset", String(circumference * (1 - ratio))),
  };
}

/**
 * Copy kèm tự xoá clipboard sau 30 giây.
 *
 * Clipboard là bộ nhớ dùng chung của cả máy: mọi app đang chạy đọc được nó, và
 * nhiều app quản lý clipboard còn lưu lịch sử xuống đĩa.
 */
function copyButton(initial: string): HTMLButtonElement & {
  element: HTMLButtonElement;
  setValue: (value: string) => void;
} {
  let value = initial;
  const button = document.createElement("button");
  button.textContent = "Copy";

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      button.textContent = "Không copy được";
      return;
    }
    const copied = value;
    button.textContent = "Đã copy";
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("copied");
    }, 2000);

    setTimeout(async () => {
      // Chỉ xoá nếu clipboard vẫn đang chứa đúng thứ ta đặt vào — nếu người dùng
      // đã copy thứ khác thì xoá đi là phá việc của họ.
      try {
        if ((await navigator.clipboard.readText()) === copied) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // Không đọc được clipboard (chưa cấp quyền) thì bỏ qua, không làm gì.
      }
    }, 30_000);
  });

  return Object.assign(button, {
    element: button,
    setValue: (next: string) => {
      value = next;
    },
  });
}

void main();
