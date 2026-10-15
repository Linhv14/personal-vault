import { createTranslator, resolveLocale, type Translate } from "../../src/i18n/index.js";
import type { LocalePreference } from "../../src/i18n/index.js";
import type {
  AutofillRequest,
  AutofillResponse,
  PendingPrompt,
  Suggestion,
} from "../lib/autofill-protocol.js";
import { icon } from "../../src/ui/icons.js";
import { logo, wordmark } from "../../src/ui/logo.js";
import { conditionalPasskeys } from "../lib/passkey/conditional.js";
import type { PasskeyOption } from "../lib/passkey/protocol.js";
import { CONTENT_STYLES } from "./styles.js";

const USERNAME_HINT = /user|email|login|account|phone|mobile|identifier/i;
const NEW_PASSWORD_HINT = /new|confirm|repeat|register|signup|sign-up|sign_up|create|join/i;

let t: Translate = createTranslator("en");
let activeInput: HTMLInputElement | null = null;
let lastCapture = { password: "", at: 0 };
let outcomeTimer: ReturnType<typeof setInterval> | undefined;

const OUTCOME_WAIT_MS = 10_000;
const OUTCOME_STABLE_MS = 1_000;
const OUTCOME_POLL_MS = 250;

const host = document.createElement("div");
host.style.cssText =
  "all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important;";
const shadow = host.attachShadow({ mode: "closed" });
const style = document.createElement("style");
style.textContent = CONTENT_STYLES;
const trigger = document.createElement("button");
trigger.className = "trigger";
trigger.type = "button";
trigger.append(logo(24));
trigger.hidden = true;
const menu = document.createElement("div");
menu.className = "menu";
menu.hidden = true;
const banner = document.createElement("div");
banner.className = "banner";
banner.hidden = true;
shadow.append(style, trigger, menu, banner);

async function send(request: AutofillRequest): Promise<AutofillResponse> {
  try {
    return (await chrome.runtime.sendMessage(request)) as AutofillResponse;
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

function isVisible(input: HTMLInputElement): boolean {
  const rect = input.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(input).visibility !== "hidden";
}

function passwordFields(scope: ParentNode = document): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(isVisible);
}

function scopeOf(input: HTMLInputElement): ParentNode {
  return input.form ?? document;
}

function describe(input: HTMLInputElement): string {
  return [input.name, input.id, input.autocomplete, input.getAttribute("aria-label") ?? ""].join(
    " ",
  );
}

function findUsernameField(password: HTMLInputElement): HTMLInputElement | null {
  const candidates = [
    ...scopeOf(password).querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[type="text"], input[type="tel"], input:not([type])',
    ),
  ].filter(
    (input) =>
      isVisible(input) &&
      password.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  const nearestFirst = candidates.reverse();
  return (
    nearestFirst.find((input) => /username|email/.test(input.autocomplete)) ??
    nearestFirst.find((input) => USERNAME_HINT.test(describe(input))) ??
    nearestFirst[0] ??
    null
  );
}

function findPasswordFor(input: HTMLInputElement): HTMLInputElement | null {
  if (input.type === "password") return input;
  return (
    passwordFields(scopeOf(input)).find(
      (field) => input.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ) ?? null
  );
}

function wantsNewPassword(password: HTMLInputElement): boolean {
  if (password.autocomplete === "new-password") return true;
  if (passwordFields(scopeOf(password)).length >= 2) return true;
  const formAction = password.form?.getAttribute("action") ?? "";
  return NEW_PASSWORD_HINT.test(`${describe(password)} ${formAction} ${location.pathname}`);
}

function wantsPasskey(input: HTMLInputElement): boolean {
  return (
    conditionalPasskeys() !== null &&
    input.type !== "password" &&
    input.autocomplete.split(/\s+/).includes("webauthn")
  );
}

function isDecoratable(input: HTMLInputElement): boolean {
  if (input.type === "password" || wantsPasskey(input)) return true;
  return findPasswordFor(input) !== null && findUsernameField(findPasswordFor(input)!) === input;
}

function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  input.focus();
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function placeTrigger(): void {
  if (!activeInput || !activeInput.isConnected || !isVisible(activeInput)) {
    trigger.hidden = true;
    return;
  }
  const rect = activeInput.getBoundingClientRect();
  const size = Math.min(24, Math.max(18, rect.height - 10));
  trigger.style.width = trigger.style.height = `${size}px`;
  trigger.style.left = `${rect.right - size - 6}px`;
  trigger.style.top = `${rect.top + (rect.height - size) / 2}px`;
  trigger.hidden = false;
  if (!menu.hidden) {
    menu.style.left = `${Math.max(8, rect.right - 280)}px`;
    menu.style.top = `${rect.bottom + 6}px`;
  }
}

function closeMenu(): void {
  menu.hidden = true;
  menu.replaceChildren();
}

function menuRow(
  label: string,
  detail: string | undefined,
  leading: HTMLElement,
  onPick: () => void,
): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "row";
  const text = document.createElement("span");
  text.className = "text";
  const strong = document.createElement("strong");
  strong.textContent = label;
  text.append(strong);
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    text.append(small);
  }
  row.append(leading, text);
  row.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    onPick();
  });
  return row;
}

function avatar(title: string): HTMLElement {
  const node = document.createElement("span");
  node.className = "avatar";
  node.textContent = [...title.trim()][0]?.toUpperCase() ?? "?";
  return node;
}

function badge(name: "lock" | "wand" | "key"): HTMLElement {
  const node = document.createElement("span");
  node.className = "badge";
  node.append(icon(name));
  return node;
}

async function fillSuggestion(suggestion: Suggestion, password: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:fill", id: suggestion.id });
  closeMenu();
  if (!response.ok || !("credentials" in response)) return;
  const username = findUsernameField(password);
  if (username && response.credentials.username) setValue(username, response.credentials.username);
  setValue(password, response.credentials.password);
}

async function fillGenerated(password: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:generate" });
  closeMenu();
  if (!response.ok || !("password" in response)) return;
  const fields = passwordFields(scopeOf(password));
  const targets = fields.length >= 2 ? fields.slice(-2) : [password];
  for (const field of targets) setValue(field, response.password);
}

async function offeredPasskeys(input: HTMLInputElement): Promise<PasskeyOption[]> {
  const passkeys = conditionalPasskeys();
  if (!passkeys || input.type === "password") return [];
  return (await passkeys.list()).passkeys;
}

async function usePasskey(passkey: PasskeyOption): Promise<void> {
  closeMenu();
  await conditionalPasskeys()?.use(passkey.credentialId);
}

async function openMenu({ onlyIfUseful }: { onlyIfUseful: boolean }): Promise<void> {
  if (!activeInput) return;
  const input = activeInput;
  const password = findPasswordFor(input) ?? input;
  const [response, passkeys] = await Promise.all([
    send({ type: "autofill:suggest" }),
    offeredPasskeys(input),
  ]);
  if (activeInput !== input) return;
  const nothingToOffer =
    response.ok &&
    "suggestions" in response &&
    response.suggestions.length === 0 &&
    passkeys.length === 0 &&
    !wantsNewPassword(password);
  if (onlyIfUseful && (!response.ok || nothingToOffer)) return;
  menu.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "heading";
  heading.append(logo(16), wordmark());
  menu.append(heading);

  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(
      menuRow(t("autofill.locked"), t("autofill.locked_hint"), badge("lock"), () => {
        void send({ type: "autofill:open-popup" });
        closeMenu();
      }),
    );
  } else if ("suggestions" in response) {
    for (const passkey of passkeys) {
      menu.append(
        menuRow(
          passkey.userName || passkey.title,
          `${t("common.passkey")} · ${passkey.title}`,
          badge("key"),
          () => void usePasskey(passkey),
        ),
      );
    }
    for (const suggestion of response.suggestions) {
      menu.append(
        menuRow(suggestion.title, suggestion.username, avatar(suggestion.title), () =>
          fillSuggestion(suggestion, password),
        ),
      );
    }
    if (wantsNewPassword(password)) {
      menu.append(
        menuRow(t("autofill.generate"), t("autofill.generate_hint"), badge("wand"), () =>
          fillGenerated(password),
        ),
      );
    } else if (response.suggestions.length === 0 && passkeys.length === 0) {
      menu.append(note(t("autofill.no_match", { domain: response.domain })));
    }
  }

  menu.hidden = false;
  placeTrigger();
}

function note(text: string): HTMLElement {
  const node = document.createElement("p");
  node.className = "note";
  node.textContent = text;
  return node;
}

function showBanner(prompt: PendingPrompt): void {
  banner.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = t(prompt.update ? "autofill.update_title" : "autofill.save_title", {
    domain: prompt.domain,
  });
  const detail = document.createElement("small");
  detail.textContent = prompt.username ?? "";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = t(prompt.update ? "autofill.update" : "autofill.save");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = t("autofill.not_now");

  save.addEventListener("click", async (event) => {
    if (!event.isTrusted) return;
    const response = await send({ type: "autofill:save" });
    if (response.ok && "saved" in response && response.saved) {
      banner.replaceChildren(logo(24), t("autofill.saved"));
      setTimeout(() => (banner.hidden = true), 2000);
    } else if (response.ok && "locked" in response && response.locked) {
      detail.textContent = t("autofill.unlock_to_save");
    } else {
      detail.textContent = t("autofill.save_failed");
    }
  });
  dismiss.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    void send({ type: "autofill:dismiss" });
    banner.hidden = true;
  });

  const text = document.createElement("div");
  text.className = "text";
  text.append(title, detail);
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(dismiss, save);
  banner.append(logo(28), text, actions);
  banner.hidden = false;
}

function capturedPassword(scope: ParentNode): string {
  const values = passwordFields(scope)
    .map((field) => field.value)
    .filter(Boolean);
  const repeated = values.find((value, index) => values.indexOf(value) !== index);
  return repeated ?? values.at(-1) ?? "";
}

async function capture(scope: ParentNode): Promise<void> {
  const fields = passwordFields(scope);
  if (fields.length === 0) return;
  const password = capturedPassword(scope);
  if (!password) return;
  if (password === lastCapture.password && Date.now() - lastCapture.at < 3000) return;
  lastCapture = { password, at: Date.now() };

  const username = findUsernameField(fields[0]!)?.value.trim() || undefined;
  const response = await send({ type: "autofill:capture", username, password });
  if (response.ok && "prompt" in response && response.prompt) {
    banner.hidden = true;
    watchOutcome(fields);
  }
}

function loginRejected(fields: HTMLInputElement[]): boolean {
  return fields.some(
    (field) =>
      field.isConnected && isVisible(field) && field.getAttribute("aria-invalid") === "true",
  );
}

function loginFormShown(fields: HTMLInputElement[]): boolean {
  return (
    fields.some((field) => field.isConnected && isVisible(field)) || passwordFields().length > 0
  );
}

function watchOutcome(fields: HTMLInputElement[]): void {
  clearInterval(outcomeTimer);
  const deadline = Date.now() + OUTCOME_WAIT_MS;
  let goneSince = 0;
  const stop = (outcome: "confirm" | "dismiss") => {
    clearInterval(outcomeTimer);
    outcomeTimer = undefined;
    if (outcome === "dismiss") {
      void send({ type: "autofill:dismiss" });
      return;
    }
    void send({ type: "autofill:confirm" }).then((response) => {
      if (response.ok && "prompt" in response && response.prompt) showBanner(response.prompt);
    });
  };
  outcomeTimer = setInterval(() => {
    if (loginRejected(fields)) return stop("dismiss");
    if (loginFormShown(fields)) {
      goneSince = 0;
      if (Date.now() > deadline) stop("dismiss");
      return;
    }
    goneSince ||= Date.now();
    if (Date.now() - goneSince >= OUTCOME_STABLE_MS) stop("confirm");
  }, OUTCOME_POLL_MS);
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !isDecoratable(target)) return;
  if (activeInput !== target) closeMenu();
  activeInput = target;
  placeTrigger();
}

trigger.addEventListener("mousedown", (event) => event.preventDefault());
trigger.addEventListener("click", (event) => {
  if (!event.isTrusted) return;
  if (menu.hidden) void openMenu({ onlyIfUseful: false });
  else closeMenu();
});

function menuRows(): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>("button.row")];
}

menu.addEventListener("keydown", (event) => {
  const rows = menuRows();
  const index = rows.indexOf(shadow.activeElement as HTMLButtonElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    rows[(index + step + rows.length) % rows.length]?.focus();
  } else if (event.key === "Escape") {
    closeMenu();
    activeInput?.focus();
  }
});

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!event.isTrusted || !(target instanceof HTMLInputElement) || !isDecoratable(target)) return;
    activeInput = target;
    placeTrigger();
    if (menu.hidden) void openMenu({ onlyIfUseful: true });
  },
  true,
);
document.addEventListener(
  "input",
  (event) => {
    if (event.isTrusted && event.target === activeInput) closeMenu();
  },
  true,
);

document.addEventListener("focusin", onFocusIn, true);
document.addEventListener(
  "mousedown",
  (event) => {
    if (event.composedPath().includes(host)) return;
    closeMenu();
    if (event.target !== activeInput) {
      activeInput = null;
      trigger.hidden = true;
    }
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
  if (event.key === "ArrowDown" && event.target === activeInput && !menu.hidden) {
    event.preventDefault();
    menuRows()[0]?.focus();
  }
  const target = event.target;
  if (event.key === "Enter" && target instanceof HTMLInputElement && target.type === "password") {
    void capture(scopeOf(target));
  }
});
document.addEventListener(
  "submit",
  (event) => {
    if (event.target instanceof HTMLFormElement) void capture(event.target);
  },
  true,
);
document.addEventListener(
  "click",
  (event) => {
    const button = (event.target as Element | null)?.closest?.(
      'button, input[type="submit"], [role="button"]',
    );
    if (!button) return;
    const scope = (button as HTMLButtonElement).form ?? button.closest("form") ?? document;
    if (passwordFields(scope).some((field) => field.value)) void capture(scope);
  },
  true,
);
window.addEventListener("scroll", placeTrigger, true);
window.addEventListener("resize", placeTrigger);

async function start(): Promise<void> {
  const { locale } = (await chrome.storage.local.get("locale")) as { locale?: LocalePreference };
  t = createTranslator(resolveLocale(locale));
  trigger.title = t("autofill.trigger");
  trigger.setAttribute("aria-label", trigger.title);
  document.documentElement.append(host);

  const response = await send({ type: "autofill:pending" });
  if (response.ok && "prompt" in response && response.prompt) {
    if (response.prompt.confirmed) showBanner(response.prompt);
    else watchOutcome([]);
  }

  if (document.activeElement instanceof HTMLInputElement) {
    onFocusIn({ target: document.activeElement } as unknown as FocusEvent);
  }
}

void start();
