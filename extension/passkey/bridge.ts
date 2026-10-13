import {
  createTranslator,
  resolveLocale,
  type LocalePreference,
  type Translate,
} from "../../src/i18n/index.js";
import { logo } from "../../src/ui/logo.js";
import {
  PAGE_ABORT,
  PAGE_REPLY,
  PAGE_REQUEST,
  type PageReply,
  type PageRequest,
  type PasskeyMessages,
  type PasskeyOption,
} from "../lib/passkey/protocol.js";
import { PASSKEY_STYLES } from "./styles.js";

const NOT_ALLOWED: PageReply = {
  kind: "error",
  name: "NotAllowedError",
  message: "The operation either timed out or was not allowed.",
};

let t: Translate = createTranslator("en");
let activeId: string | null = null;
let closeDialog: (() => void) | null = null;

type CreateRequest = Extract<PageRequest, { kind: "create" }>;
type GetRequest = Extract<PageRequest, { kind: "get" }>;

async function send<K extends keyof PasskeyMessages>(
  type: K,
  request: PasskeyMessages[K]["request"],
): Promise<PasskeyMessages[K]["response"] | { ok: false; error: "unavailable" }> {
  try {
    return await chrome.runtime.sendMessage({ type, ...request });
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

function reply(id: string, value: PageReply): void {
  if (activeId === id) activeId = null;
  closeDialog?.();
  window.postMessage({ type: PAGE_REPLY, id, reply: value }, location.origin);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function trustedClick(button: HTMLElement, action: () => void): void {
  button.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    action();
  });
}

function dialog(title: string, subtitle: string, onDismiss: () => void): HTMLElement {
  closeDialog?.();
  const host = document.createElement("div");
  host.style.cssText =
    "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = PASSKEY_STYLES;
  const backdrop = element("div", "backdrop");
  const card = element("div", "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  const head = element("div", "head");
  const heading = element("div", "heading");
  heading.append(element("strong", "title", title), element("span", "subtitle", subtitle));
  const close = element("button", "close", "×");
  close.setAttribute("aria-label", t("common.close"));
  head.append(logo(28), heading, close);
  const body = element("div", "body");
  card.append(head, body);
  backdrop.append(card);
  shadow.append(style, backdrop);
  (document.body ?? document.documentElement).append(host);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && event.isTrusted) onDismiss();
  };
  document.addEventListener("keydown", onKey, true);
  trustedClick(close, onDismiss);
  closeDialog = () => {
    document.removeEventListener("keydown", onKey, true);
    host.remove();
    closeDialog = null;
  };
  return body;
}

function actions(...buttons: HTMLButtonElement[]): HTMLElement {
  const row = element("div", "actions");
  row.append(...buttons);
  return row;
}

function button(label: string, primary: boolean, action: () => void): HTMLButtonElement {
  const node = element("button", primary ? "button primary" : "button", label);
  node.type = "button";
  trustedClick(node, action);
  return node;
}

const UNLOCK_POLL_MS = 1000;

function showLocked(id: string, site: string, resume: () => void): void {
  const body = dialog(t("passkey.locked_title"), site, () => reply(id, NOT_ALLOWED));
  body.append(
    element("p", "hint", t("passkey.locked_hint")),
    actions(button(t("passkey.unlock"), true, () => void send("passkey:open-popup", {}))),
    other(id),
  );
  const timer = setInterval(async () => {
    if (activeId !== id) return clearInterval(timer);
    const query = await send("passkey:query", { allowCredentialIds: [] });
    if (activeId !== id || (query.ok && query.state === "locked")) return;
    clearInterval(timer);
    resume();
  }, UNLOCK_POLL_MS);
}

function other(id: string): HTMLElement {
  const link = element("button", "link", t("passkey.other_device"));
  link.type = "button";
  trustedClick(link, () => reply(id, { kind: "fallback" }));
  return link;
}

function failed(id: string, site: string): void {
  const body = dialog(t("passkey.failed_title"), site, () => reply(id, NOT_ALLOWED));
  body.append(element("p", "hint", t("passkey.failed")), other(id));
}

async function handleCreate(id: string, request: CreateRequest): Promise<void> {
  const query = await send("passkey:query", { rpId: request.options.rpId, allowCredentialIds: [] });
  if (activeId !== id) return;
  if (!query.ok) return reply(id, { kind: "fallback" });
  if (query.state === "locked") {
    return showLocked(id, location.hostname, () => void handleCreate(id, request));
  }

  const site = query.rpId;
  const body = dialog(t("passkey.save_title", { site }), request.options.userName, () =>
    reply(id, NOT_ALLOWED),
  );
  const save = button(t("passkey.save_action"), true, async () => {
    save.disabled = true;
    const result = await send("passkey:create", { options: request.options });
    if (activeId !== id) return;
    if (result.ok) return reply(id, { kind: "registration", registration: result.registration });
    if (result.error === "excluded") {
      return reply(id, {
        kind: "error",
        name: "InvalidStateError",
        message: "This passkey is already registered.",
      });
    }
    failed(id, site);
  });
  body.append(actions(save), other(id));
}

function accountRow(id: string, site: string, passkey: PasskeyOption, request: GetRequest) {
  const row = element("button", "account");
  row.type = "button";
  const text = element("span", "account-text");
  text.append(
    element("strong", "", passkey.userName || passkey.title),
    element("small", "", passkey.title),
  );
  row.append(element("span", "avatar", (passkey.title.trim()[0] ?? "?").toUpperCase()), text);
  trustedClick(row, async () => {
    row.disabled = true;
    const result = await send("passkey:get", {
      options: request.options,
      credentialId: passkey.credentialId,
    });
    if (activeId !== id) return;
    if (result.ok) return reply(id, { kind: "assertion", assertion: result.assertion });
    failed(id, site);
  });
  return row;
}

async function handleGet(id: string, request: GetRequest): Promise<void> {
  const query = await send("passkey:query", {
    rpId: request.options.rpId,
    allowCredentialIds: request.options.allowCredentialIds,
  });
  if (activeId !== id) return;
  if (!query.ok) return reply(id, { kind: "fallback" });
  if (query.state === "locked") {
    if (!query.hasPasskeys) return reply(id, { kind: "fallback" });
    return showLocked(id, location.hostname, () => void handleGet(id, request));
  }
  if (query.passkeys.length === 0) return reply(id, { kind: "fallback" });

  const site = query.rpId;
  const body = dialog(t("passkey.signin_title", { site }), t("passkey.choose_account"), () =>
    reply(id, NOT_ALLOWED),
  );
  const list = element("div", "accounts");
  list.append(...query.passkeys.map((passkey) => accountRow(id, site, passkey, request)));
  body.append(list, other(id));
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { type?: string; id?: string; request?: PageRequest } | null;
  if (data?.type === PAGE_ABORT && data.id === activeId) {
    activeId = null;
    closeDialog?.();
    return;
  }
  if (data?.type !== PAGE_REQUEST || typeof data.id !== "string" || !data.request) return;
  if (activeId) reply(activeId, NOT_ALLOWED);
  activeId = data.id;
  if (data.request.kind === "create") void handleCreate(data.id, data.request);
  else if (data.request.kind === "get") void handleGet(data.id, data.request);
});

void (async () => {
  const { locale } = (await chrome.storage.local.get("locale")) as { locale?: LocalePreference };
  t = createTranslator(resolveLocale(locale));
})();
