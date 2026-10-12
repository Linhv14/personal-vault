/**
 * The share recipient page. Runs entirely in the recipient's browser.
 *
 * Two rules drive the order of everything below:
 *
 * 1. The key lives in `location.hash`, and a fragment is never sent to a server.
 *    Do not log it and never put it in a request.
 * 2. Every GET of the share spends one view. So a link that needs a passphrase
 *    must prompt *before* fetching, and retries must reuse the response already
 *    in memory rather than asking again.
 */

import { fragmentNeedsPassphrase, openShare, type SharePayload } from "../src/core/share.js";
import { generateTotp, secondsRemaining, TOTP_DEFAULTS } from "../src/core/totp.js";
import {
  createTranslator,
  describeError,
  detectLocale,
  type MessageKey,
  type Translate,
} from "../src/i18n/index.js";

interface ShareResponse {
  ciphertext: string;
  nonce: string;
  expiresAt: number;
  viewsLeft: number;
}

const locale = detectLocale();
const t: Translate = createTranslator(locale);

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
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

function applyStaticText(): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n as MessageKey);
  }
  for (const node of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    node.placeholder = t(node.dataset.i18nPlaceholder as MessageKey);
  }
  document.documentElement.lang = locale;
  document.title = t("view.default_title");
}

const shareId = location.pathname.split("/").filter(Boolean).pop() ?? "";
const fragment = location.hash;

let cached: ShareResponse | null = null;

async function main(): Promise<void> {
  applyStaticText();

  if (!shareId || !fragment || fragment === "#") {
    fail(t("view.missing_key"));
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

  if (!cached) {
    show("loading");
    try {
      cached = await fetchShare();
    } catch (error) {
      fail(describeError(error, t));
      return;
    }
  }

  try {
    render(await openShare(fragment, cached, input.value));
  } catch (error) {
    show("passphrase");
    errorNode.textContent = describeError(error, t);
    errorNode.hidden = false;
    input.select();
  }
}

async function fetchShare(): Promise<ShareResponse> {
  const response = await fetch(`/api/shares/${encodeURIComponent(shareId)}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    const key = body?.code ? (`error.${body.code}` as MessageKey) : "error.api.generic";
    throw new Error(t(key, { status: response.status }));
  }
  return (await response.json()) as ShareResponse;
}

async function load(): Promise<void> {
  show("loading");
  try {
    cached = await fetchShare();
    render(await openShare(fragment, cached));
  } catch (error) {
    fail(describeError(error, t));
  }
}

function render(payload: SharePayload): void {
  history.replaceState(null, "", location.pathname);
  el("title").textContent = payload.title?.trim() || t("view.default_title");

  const parts: string[] = [];
  if (payload.url) parts.push(payload.url);
  if (cached) {
    const minutes = Math.max(0, Math.round((cached.expiresAt * 1000 - Date.now()) / 60_000));
    parts.push(
      minutes >= 60
        ? t("view.expires_hours", { count: Math.round(minutes / 60) })
        : t("view.expires_minutes", { count: minutes }),
    );
  }
  el("meta").textContent = parts.join(" · ");

  const fields = el("fields");
  fields.replaceChildren();

  if (payload.username) fields.append(textField(t("common.username"), payload.username));
  if (payload.password) fields.append(textField(t("common.password"), payload.password, true));
  if (payload.totp) fields.append(totpField(payload.totp));
  if (payload.note) fields.append(noteField(payload.note));

  el("warning").textContent = cached?.viewsLeft
    ? t("view.views_left", { count: cached.viewsLeft })
    : t("view.last_view");

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
  const masked = "•".repeat(Math.min(value.length, 20));
  // textContent, never innerHTML: this content comes from the sender.
  valueNode.textContent = secret ? masked : value;

  row.append(valueNode);

  if (secret) {
    let revealed = false;
    const toggle = document.createElement("button");
    toggle.textContent = t("common.show");
    toggle.addEventListener("click", () => {
      revealed = !revealed;
      valueNode.textContent = revealed ? value : masked;
      valueNode.className = revealed ? "value" : "value hidden";
      toggle.textContent = t(revealed ? "common.hide" : "common.show");
    });
    row.append(toggle);
  }

  row.append(copyButton(value).element);
  return wrap;
}

function noteField(value: string): HTMLElement {
  const { wrap, row } = field(t("common.note"));
  const valueNode = document.createElement("div");
  valueNode.className = "value note";
  valueNode.textContent = value;
  row.append(valueNode, copyButton(value).element);
  return wrap;
}

/** Live 2FA code, computed locally per RFC 6238 — no network involved. */
function totpField(config: NonNullable<SharePayload["totp"]>): HTMLElement {
  const period = config.period || TOTP_DEFAULTS.period;
  const label = t("view.totp_label", { issuer: config.issuer ? ` · ${config.issuer}` : "" });
  const { wrap, row } = field(label);

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

    const counter = Math.floor(Date.now() / 1000 / period);
    if (counter === lastCounter) return;
    lastCounter = counter;
    try {
      const code = await generateTotp(config);
      codeNode.textContent = code.replace(/(\d{3})(?=\d)/, "$1 ");
      copy.setValue(code);
    } catch {
      codeNode.textContent = "—";
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), 1000);
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

  const progress = make("progress");
  progress.setAttribute("stroke-dasharray", String(circumference));
  svg.append(make("track"), progress);

  return {
    svg,
    update: (ratio) =>
      progress.setAttribute("stroke-dashoffset", String(circumference * (1 - ratio))),
  };
}

/**
 * Copy, then clear the clipboard after 30 seconds. The clipboard is shared with
 * every running application, and clipboard managers often persist history.
 */
function copyButton(initial: string): {
  element: HTMLButtonElement;
  setValue: (value: string) => void;
} {
  let value = initial;
  const button = document.createElement("button");
  button.textContent = t("common.copy");

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    const copied = value;
    button.textContent = "✓";
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = t("common.copy");
      button.classList.remove("copied");
    }, 2000);

    setTimeout(async () => {
      try {
        // Only clear what we put there; the user may have copied something else.
        if ((await navigator.clipboard.readText()) === copied) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        /* clipboard-read permission not granted */
      }
    }, 30_000);
  });

  return {
    element: button,
    setValue: (next: string) => {
      value = next;
    },
  };
}

void main();
