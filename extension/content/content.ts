import { createTranslator, resolveLocale, type Translate } from "../../src/i18n/index.js";
import type { LocalePreference } from "../../src/i18n/index.js";
import type {
  AddressData,
  AutofillRequest,
  AutofillResponse,
  FormPrompt,
  PendingPrompt,
  Suggestion,
  TotpPrompt,
} from "../lib/autofill-protocol.js";
import { icon, type IconName } from "../../src/ui/icons.js";
import { fromBase64 } from "../../src/core/bytes.js";
import { logo, wordmark } from "../../src/ui/logo.js";
import { brandMark, flagMark } from "../../src/ui/marks.js";
import { isPaymentFrameUrl } from "../../src/core/payment-frames.js";
import type { LookalikeMatch } from "../../src/core/lookalike.js";
import { CARD_BRAND_NAMES } from "../lib/item-types.js";
import { conditionalPasskeys } from "../lib/passkey/conditional.js";
import type { PasskeyOption } from "../lib/passkey/protocol.js";
import { CONTENT_STYLES } from "./styles.js";
import {
  countryHint,
  detectFields,
  fillAddress,
  fillCard,
  formKindOf,
  isCardKind,
  setFieldValue,
  type FormField,
  type FormKind,
} from "./forms.js";
import {
  fillState,
  isSubmitLike,
  readAddress,
  readCard,
  type FilledFields,
} from "./form-capture.js";
import {
  fillCode,
  findOneTimeCodeField,
  findSetupQr,
  findSetupText,
  isOneTimeCodeField,
  mentionsSetup,
} from "./two-factor.js";

const USERNAME_HINT = /user|email|login|account|phone|mobile|identifier/i;
const NEW_PASSWORD_HINT = /new|confirm|repeat|register|signup|sign-up|sign_up|create|join/i;
const SIGN_UP_BUTTON =
  /sign\s?up|create( an)? account|register|join|get started|đăng ký|tạo tài khoản/i;

let t: Translate = createTranslator("en");
let activeInput: HTMLInputElement | null = null;
let cardFrame: HTMLIFrameElement | null = null;
let lastCapture = { password: "", at: 0 };
let outcomeTimer: ReturnType<typeof setInterval> | undefined;
let siteWarning: LookalikeMatch | null = null;
let lastFormCapture = { key: "", at: 0 };
const filled: FilledFields = new WeakMap();

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
const chip = document.createElement("div");
chip.className = "chip";
chip.hidden = true;
shadow.append(style, trigger, menu, banner, chip);

function trackValue(element: FormField, value: string, random: boolean): void {
  setFieldValue(element, value);
  if (!(element instanceof HTMLInputElement && element.type === "password")) {
    filled.set(element, { value: element.value, random });
  }
}

function setValue(element: FormField, value: string): void {
  trackValue(element, value, false);
}

function setRandomValue(element: FormField, value: string): void {
  trackValue(element, value, true);
}

async function send(request: AutofillRequest): Promise<AutofillResponse> {
  try {
    return await chrome.runtime.sendMessage<AutofillRequest, AutofillResponse>(request);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

function isVisible(input: HTMLElement): boolean {
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
  if (input.type === "password") {
    return input;
  }
  return (
    passwordFields(scopeOf(input)).find(
      (field) => input.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ) ?? null
  );
}

function wantsNewPassword(password: HTMLInputElement): boolean {
  if (password.autocomplete === "new-password") {
    return true;
  }
  if (passwordFields(scopeOf(password)).length >= 2) {
    return true;
  }
  if (password.autocomplete === "current-password") {
    return false;
  }
  const formAction = password.form?.getAttribute("action") ?? "";
  if (NEW_PASSWORD_HINT.test(`${describe(password)} ${formAction} ${location.pathname}`)) {
    return true;
  }
  const buttons = [
    ...scopeOf(password).querySelectorAll<HTMLElement>(
      'button, input[type="submit"], [role="button"]',
    ),
  ];
  return buttons.some((button) =>
    SIGN_UP_BUTTON.test(button.textContent || (button as HTMLInputElement).value || ""),
  );
}

function wantsPasskey(input: HTMLInputElement): boolean {
  return (
    conditionalPasskeys() !== null &&
    input.type !== "password" &&
    input.autocomplete.split(/\s+/).includes("webauthn")
  );
}

function isLoginUsername(input: HTMLInputElement): boolean {
  const password = findPasswordFor(input);
  return input.type !== "password" && password !== null && findUsernameField(password) === input;
}

function formKind(input: HTMLInputElement): FormKind | null {
  if (input.type === "password" || wantsPasskey(input) || isLoginUsername(input)) {
    return null;
  }
  return formKindOf(input, detectFields(scopeOf(input)));
}

function isCodeField(input: HTMLInputElement): boolean {
  return isOneTimeCodeField(input) && formKind(input) !== "card";
}

function isDecoratable(input: HTMLInputElement): boolean {
  if (input.type === "password" || wantsPasskey(input) || isCodeField(input)) {
    return true;
  }
  return isLoginUsername(input) || formKind(input) !== null;
}

function placeTrigger(): void {
  const anchor = activeInput ?? cardFrame;
  if (!anchor || !anchor.isConnected || !isVisible(anchor)) {
    trigger.hidden = true;
    return;
  }
  const rect = anchor.getBoundingClientRect();
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
    if (!event.isTrusted) {
      return;
    }
    if (siteWarning && !row.dataset.armed) {
      return armRow(row);
    }
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

function badge(name: IconName): HTMLElement {
  const node = document.createElement("span");
  node.className = "badge";
  node.append(icon(name));
  return node;
}

async function fillSuggestion(suggestion: Suggestion, password: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:fill", id: suggestion.id });
  closeMenu();
  if (!response.ok || !("credentials" in response)) {
    return;
  }
  const username = findUsernameField(password);
  if (username && response.credentials.username) {
    setValue(username, response.credentials.username);
  }
  setValue(password, response.credentials.password);
}

async function fillGenerated(password: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:generate" });
  closeMenu();
  if (!response.ok || !("password" in response)) {
    return;
  }
  const fields = passwordFields(scopeOf(password));
  const targets = fields.length >= 2 ? fields.slice(-2) : [password];
  for (const field of targets) {
    setValue(field, response.password);
  }
}

async function offeredPasskeys(input: HTMLInputElement): Promise<PasskeyOption[]> {
  const passkeys = conditionalPasskeys();
  if (!passkeys || input.type === "password") {
    return [];
  }
  return (await passkeys.list()).passkeys;
}

async function usePasskey(passkey: PasskeyOption): Promise<void> {
  closeMenu();
  await conditionalPasskeys()?.use(passkey.credentialId);
}

async function fillOneTimeCode(suggestion: Suggestion, input: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:code", id: suggestion.id });
  closeMenu();
  if (response.ok && "code" in response && typeof response.code === "string") {
    fillCode(input, response.code, setValue);
  }
}

function menuHeading(): HTMLElement {
  if (siteWarning) {
    return warningHeading(siteWarning);
  }
  const heading = document.createElement("div");
  heading.className = "heading";
  heading.append(logo(16), wordmark());
  return heading;
}

function lockedRow(): HTMLButtonElement {
  const row = menuRow(t("autofill.locked"), t("autofill.locked_hint"), badge("lock"), () => {
    void send({ type: "autofill:open-popup" });
    closeMenu();
  });
  row.dataset.armed = "1";
  return row;
}

async function openCodeMenu(input: HTMLInputElement, onlyIfUseful: boolean): Promise<void> {
  const response = await send({ type: "autofill:codes" });
  if (activeInput !== input) {
    return;
  }
  const empty = response.ok && "suggestions" in response && response.suggestions.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  } else if ("suggestions" in response) {
    for (const suggestion of response.suggestions) {
      menu.append(
        menuRow(
          suggestion.title,
          [suggestion.username, suggestion.vault].filter(Boolean).join(" · ") || undefined,
          badge("clock"),
          () => void fillOneTimeCode(suggestion, input),
        ),
      );
    }
    if (response.suggestions.length === 0) {
      menu.append(note(t("autofill.no_codes", { domain: response.domain })));
    }
  }
  menu.hidden = false;
  placeTrigger();
}

function showMenu(): void {
  menu.hidden = false;
  placeTrigger();
}

async function fillCardItem(id: string, input: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:card", id });
  closeMenu();
  if (!response.ok || !("card" in response)) {
    return;
  }
  fillCard(detectFields(scopeOf(input)), response.card, setValue);
}

async function fillAddressFrom(request: AutofillRequest, input: HTMLInputElement): Promise<void> {
  const response = await send(request);
  closeMenu();
  if (!response.ok || !("identity" in response)) {
    return;
  }
  const data: AddressData = response.identity;
  const random = request.type === "autofill:random-address";
  fillAddress(detectFields(scopeOf(input)), data, random ? setRandomValue : setValue);
}

async function openFrameCardMenu(frame: HTMLIFrameElement, onlyIfUseful: boolean): Promise<void> {
  const response = await send({ type: "autofill:cards" });
  if (cardFrame !== frame) {
    return;
  }
  const empty = response.ok && "cards" in response && response.cards.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  } else if ("cards" in response) {
    for (const card of response.cards) {
      menu.append(
        menuRow(
          `•••• ${card.last4}`,
          [card.title, card.vault].filter(Boolean).join(" · ") || undefined,
          card.brand === "card" ? badge("card") : brandMark(card.brand),
          () => void fillCardFrom(card.id),
        ),
      );
    }
    if (response.cards.length === 0) {
      menu.append(note(t("autofill.no_cards")));
    }
  }
  showMenu();
}

async function fillCardFrom(id: string): Promise<void> {
  const response = await send({ type: "autofill:card", id });
  closeMenu();
  if (!response.ok || !("card" in response)) {
    return;
  }
  fillCard(detectFields(document), response.card, setValue);
}

function onWindowBlur(): void {
  setTimeout(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLIFrameElement) || !isPaymentFrameUrl(focused.src)) {
      return;
    }
    if (cardFrame !== focused) {
      closeMenu();
    }
    activeInput = null;
    cardFrame = focused;
    placeTrigger();
    void checkSite();
    if (menu.hidden) {
      void openFrameCardMenu(focused, true);
    }
  }, 0);
}

async function openCardMenu(input: HTMLInputElement, onlyIfUseful: boolean): Promise<void> {
  const response = await send({ type: "autofill:cards" });
  if (activeInput !== input) {
    return;
  }
  const empty = response.ok && "cards" in response && response.cards.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  } else if ("cards" in response) {
    for (const card of response.cards) {
      menu.append(
        menuRow(
          `•••• ${card.last4}`,
          [card.title, card.vault].filter(Boolean).join(" · ") || undefined,
          card.brand === "card" ? badge("card") : brandMark(card.brand),
          () => void fillCardItem(card.id, input),
        ),
      );
    }
    if (response.cards.length === 0) {
      menu.append(note(t("autofill.no_cards")));
    }
  }
  showMenu();
}

function isEmailInput(input: HTMLInputElement): boolean {
  return (
    input.type === "email" || /e-?mail/i.test(`${input.autocomplete} ${input.name} ${input.id}`)
  );
}

async function aliasRows(input: HTMLInputElement): Promise<HTMLElement[]> {
  if (!isEmailInput(input)) {
    return [];
  }
  const response = await send({ type: "autofill:aliases" });
  if (!response.ok || !("aliases" in response)) {
    return [];
  }
  return response.aliases.map((alias) =>
    menuRow(t("autofill.alias", { site: response.site }), alias, badge("mail"), () => {
      closeMenu();
      setValue(input, alias);
    }),
  );
}

async function openAddressMenu(
  input: HTMLInputElement,
  onlyIfUseful: boolean,
  profile = false,
): Promise<void> {
  const [response, aliases] = await Promise.all([
    send({ type: "autofill:identities" }),
    aliasRows(input),
  ]);
  if (activeInput !== input) {
    return;
  }
  const empty =
    response.ok &&
    "identities" in response &&
    response.identities.length === 0 &&
    aliases.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
    showMenu();
    return;
  }
  if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  }
  if ("identities" in response) {
    for (const identity of response.identities) {
      menu.append(
        menuRow(
          identity.title,
          [identity.detail, identity.vault].filter(Boolean).join(" · ") || undefined,
          identity.country ? flagMark(identity.country) : badge("person"),
          () => void fillAddressFrom({ type: "autofill:identity", id: identity.id }, input),
        ),
      );
    }
  }
  menu.append(...aliases);
  const country = countryHint(
    detectFields(scopeOf(input)),
    location.hostname,
    document.documentElement.lang,
  );
  for (const code of country === "VN" ? (["VN", "US"] as const) : (["US", "VN"] as const)) {
    menu.append(
      menuRow(
        t(profile ? "autofill.random_profile" : "autofill.random_address"),
        t(code === "VN" ? "autofill.random_in_vn" : "autofill.random_in_us"),
        flagMark(code),
        () => fillAddressFrom({ type: "autofill:random-address", country: code }, input),
      ),
    );
  }
  showMenu();
}

async function openMenu({ onlyIfUseful }: { onlyIfUseful: boolean }): Promise<void> {
  if (!activeInput) {
    return;
  }
  const input = activeInput;
  if (isCodeField(input)) {
    return openCodeMenu(input, onlyIfUseful);
  }
  const kind = formKind(input);
  if (kind === "card") {
    return openCardMenu(input, onlyIfUseful);
  }
  if (kind === "address") {
    return openAddressMenu(input, onlyIfUseful);
  }
  if (kind === "profile") {
    return openAddressMenu(input, onlyIfUseful, true);
  }
  const password = findPasswordFor(input) ?? input;
  const signUp = wantsNewPassword(password);
  const [response, passkeys, aliases] = await Promise.all([
    send({ type: "autofill:suggest" }),
    offeredPasskeys(input),
    signUp && input !== password ? aliasRows(input) : Promise.resolve([]),
  ]);
  if (activeInput !== input) {
    return;
  }
  const nothingToOffer =
    response.ok &&
    "suggestions" in response &&
    response.suggestions.length === 0 &&
    passkeys.length === 0 &&
    !wantsNewPassword(password);
  if (onlyIfUseful && (!response.ok || nothingToOffer)) {
    return;
  }
  menu.replaceChildren(menuHeading());

  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
  } else if ("locked" in response && response.locked) {
    menu.append(lockedRow());
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
        menuRow(
          suggestion.title,
          [suggestion.username, suggestion.vault].filter(Boolean).join(" · ") || undefined,
          avatar(suggestion.title),
          () => fillSuggestion(suggestion, password),
        ),
      );
    }
    menu.append(...aliases);
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

function bannerField(label: string, input: HTMLInputElement, extra?: HTMLElement): HTMLElement {
  const row = document.createElement("label");
  row.className = "field";
  const caption = document.createElement("span");
  caption.textContent = label;
  const box = document.createElement("span");
  box.className = "field-box";
  box.append(input);
  if (extra) {
    box.append(extra);
  }
  row.append(caption, box);
  return row;
}

function showBanner(prompt: PendingPrompt): void {
  banner.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = t(prompt.update ? "autofill.update_title" : "autofill.save_title", {
    domain: prompt.domain,
  });
  const detail = document.createElement("small");
  detail.hidden = true;

  const username = document.createElement("input");
  username.type = "text";
  username.autocomplete = "off";
  username.spellcheck = false;
  username.value = prompt.username ?? "";
  const password = document.createElement("input");
  password.type = "password";
  password.autocomplete = "off";
  password.spellcheck = false;
  password.value = prompt.password;
  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.className = "reveal";
  const showReveal = () => {
    const hidden = password.type === "password";
    reveal.replaceChildren(icon(hidden ? "eye" : "eye-off"));
    reveal.setAttribute("aria-label", t(hidden ? "common.show" : "common.hide"));
  };
  showReveal();
  reveal.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    password.type = password.type === "password" ? "text" : "password";
    showReveal();
  });
  const fields = document.createElement("div");
  fields.className = "fields";
  fields.append(
    bannerField(t("common.username"), username),
    bannerField(t("common.password"), password, reveal),
  );

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = t(prompt.update ? "autofill.update" : "autofill.save");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = t("autofill.not_now");
  password.addEventListener("input", () => (save.disabled = !password.value));

  save.addEventListener("click", async (event) => {
    if (!event.isTrusted || !password.value) {
      return;
    }
    const response = await send({
      type: "autofill:save",
      username: username.value,
      password: password.value,
    });
    if (response.ok && "saved" in response && response.saved) {
      banner.replaceChildren(logo(28), t("autofill.saved"));
      setTimeout(() => (banner.hidden = true), 2000);
      return;
    }
    detail.hidden = false;
    detail.textContent =
      response.ok && "locked" in response && response.locked
        ? t("autofill.unlock_to_save")
        : t("autofill.save_failed");
  });
  dismiss.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    void send({ type: "autofill:dismiss" });
    banner.hidden = true;
  });

  const text = document.createElement("div");
  text.className = "text";
  text.append(title, detail);
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(dismiss, save);
  banner.append(logo(28), text, fields, actions);
  banner.hidden = false;
}

let totpSeen = "";
let setupScans = 0;
let setupTimer: ReturnType<typeof setTimeout> | undefined;
const MAX_SETUP_SCANS = 20;

function showTotpBanner(prompt: TotpPrompt): void {
  banner.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = t("autofill.totp_title", { domain: prompt.domain });
  const detail = document.createElement("small");
  detail.textContent = prompt.target
    ? t(prompt.replace ? "autofill.totp_replace" : "autofill.totp_add", { title: prompt.target })
    : t("autofill.totp_new");

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = t("autofill.save");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = t("autofill.not_now");

  save.addEventListener("click", async (event) => {
    if (!event.isTrusted) {
      return;
    }
    const response = await send({ type: "autofill:totp-save" });
    if (response.ok && "saved" in response && response.saved) {
      const field = findOneTimeCodeField();
      if (field && response.code) {
        fillCode(field, response.code, setValue);
      }
      banner.replaceChildren(
        logo(24),
        t(field && response.code ? "autofill.totp_saved_filled" : "autofill.saved"),
      );
      setTimeout(() => (banner.hidden = true), 2500);
    } else if (response.ok && "locked" in response && response.locked) {
      detail.textContent = t("autofill.unlock_to_save");
    } else {
      detail.textContent = t("autofill.save_failed");
    }
  });
  dismiss.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    void send({ type: "autofill:totp-dismiss" });
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

async function scanForSetup(): Promise<void> {
  if (setupScans >= MAX_SETUP_SCANS || !banner.hidden) {
    return;
  }
  if (!mentionsSetup(document.body?.textContent ?? "")) {
    return;
  }
  setupScans++;
  const found =
    findSetupText() ??
    (await findSetupQr(document, async (url) => {
      const response = await send({ type: "autofill:qr-image", url });
      if (!response.ok || !("image" in response) || !response.image) {
        return null;
      }
      const [header = "", data = ""] = response.image.split(",");
      return new Blob([fromBase64(data)], { type: header.slice(5).split(";")[0] });
    }));
  if (!found || found === totpSeen) {
    return;
  }
  totpSeen = found;
  const response = await send({ type: "autofill:totp-found", text: found });
  if (response.ok && "totp" in response && response.totp) {
    showTotpBanner(response.totp);
  }
}

function scheduleSetupScan(): void {
  clearTimeout(setupTimer);
  setupTimer = setTimeout(() => void scanForSetup(), 800);
}

function capturedPassword(scope: ParentNode): string {
  const values = passwordFields(scope)
    .map((field) => field.value)
    .filter(Boolean);
  const repeated = values.find((value, index) => values.indexOf(value) !== index);
  return repeated ?? values.at(-1) ?? "";
}

function rememberIdentifier(scope: ParentNode): void {
  const field = [
    ...scope.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[type="text"], input[type="tel"], input:not([type])',
    ),
  ].find(
    (input) =>
      isVisible(input) &&
      input.value.trim() &&
      (/username|email/.test(input.autocomplete) || USERNAME_HINT.test(describe(input))),
  );
  if (field) {
    void send({ type: "autofill:identifier", username: field.value.trim() });
  }
}

async function capture(scope: ParentNode): Promise<void> {
  const fields = passwordFields(scope);
  if (fields.length === 0) {
    if (scope !== document) {
      rememberIdentifier(scope);
    }
    return;
  }
  const password = capturedPassword(scope);
  if (!password) {
    return;
  }
  if (password === lastCapture.password && Date.now() - lastCapture.at < 3000) {
    return;
  }
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
      if (response.ok && "prompt" in response && response.prompt) {
        showBanner(response.prompt);
      }
    });
  };
  outcomeTimer = setInterval(() => {
    if (loginRejected(fields)) {
      return stop("dismiss");
    }
    if (loginFormShown(fields)) {
      goneSince = 0;
      if (Date.now() > deadline) {
        stop("dismiss");
      }
      return;
    }
    goneSince ||= Date.now();
    if (Date.now() - goneSince >= OUTCOME_STABLE_MS) {
      stop("confirm");
    }
  }, OUTCOME_POLL_MS);
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !isDecoratable(target)) {
    return;
  }
  if (activeInput !== target) {
    closeMenu();
  }
  activeInput = target;
  cardFrame = null;
  placeTrigger();
  void checkSite();
  const offersPassword = target.type === "password" && !target.value && wantsNewPassword(target);
  if (menu.hidden && (offersPassword || (isCodeField(target) && !target.value))) {
    void openMenu({ onlyIfUseful: true });
  }
}

trigger.addEventListener("mousedown", (event) => event.preventDefault());
trigger.addEventListener("click", (event) => {
  if (!event.isTrusted) {
    return;
  }
  if (!menu.hidden) {
    closeMenu();
  } else if (!activeInput && cardFrame) {
    void openFrameCardMenu(cardFrame, false);
  } else {
    void openMenu({ onlyIfUseful: false });
  }
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
    if (!event.isTrusted || !(target instanceof HTMLInputElement) || !isDecoratable(target)) {
      return;
    }
    activeInput = target;
    placeTrigger();
    if (menu.hidden) {
      void openMenu({ onlyIfUseful: true });
    }
  },
  true,
);
document.addEventListener(
  "input",
  (event) => {
    if (event.isTrusted && event.target === activeInput) {
      closeMenu();
    }
  },
  true,
);

document.addEventListener("focusin", onFocusIn, true);
window.addEventListener("blur", onWindowBlur);
document.addEventListener(
  "mousedown",
  (event) => {
    if (event.composedPath().includes(host)) {
      return;
    }
    closeMenu();
    if (event.target !== activeInput) {
      activeInput = null;
      cardFrame = null;
      trigger.hidden = true;
    }
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
  }
  if (event.key === "ArrowDown" && event.target === activeInput && !menu.hidden) {
    event.preventDefault();
    menuRows()[0]?.focus();
  }
  const target = event.target;
  if (event.key === "Enter" && target instanceof HTMLInputElement) {
    if (target.type === "password") {
      void capture(scopeOf(target));
    } else if (target.form) {
      rememberIdentifier(target.form);
    }
  }
});
document.addEventListener(
  "submit",
  (event) => {
    if (event.target instanceof HTMLFormElement) {
      void capture(event.target);
    }
  },
  true,
);
document.addEventListener(
  "click",
  (event) => {
    const button = (event.target as Element | null)?.closest?.(
      'button, input[type="submit"], [role="button"]',
    );
    if (!button) {
      return;
    }
    const scope = (button as HTMLButtonElement).form ?? button.closest("form") ?? document;
    if (passwordFields(scope).some((field) => field.value)) {
      void capture(scope);
    } else if (scope !== document) {
      rememberIdentifier(scope);
    }
  },
  true,
);
window.addEventListener("scroll", placeTrigger, true);
window.addEventListener("resize", placeTrigger);

function warningHeading(warning: LookalikeMatch): HTMLElement {
  const heading = document.createElement("div");
  heading.className = "heading warning";
  const title = document.createElement("strong");
  title.textContent = t("autofill.lookalike_title", { domain: warning.target });
  heading.append(icon("alert"), title);
  return heading;
}

function armRow(row: HTMLButtonElement): void {
  row.dataset.armed = "1";
  row.classList.add("armed");
  const text = row.querySelector(".text");
  let detail = text?.querySelector("small");
  if (text && !detail) {
    detail = document.createElement("small");
    text.append(detail);
  }
  if (detail) {
    detail.textContent = t("autofill.fill_anyway");
  }
  row.focus();
}

async function checkSite(): Promise<LookalikeMatch | null> {
  if (location.protocol !== "https:") {
    return null;
  }
  const response = await send({ type: "autofill:site-check" });
  const warning = response.ok && "lookalike" in response ? response.lookalike : null;
  const changed = warning?.target !== siteWarning?.target;
  siteWarning = warning;
  if (changed && !menu.hidden) {
    menu.querySelector(".heading")?.replaceWith(menuHeading());
  }
  return warning;
}

function showChip(field: HTMLInputElement, warning: LookalikeMatch): void {
  const rect = field.getBoundingClientRect();
  chip.replaceChildren(icon("alert"), t("autofill.lookalike_title", { domain: warning.target }));
  chip.style.left = `${Math.max(8, rect.left)}px`;
  chip.style.top = `${rect.bottom + 6}px`;
  chip.hidden = false;
  const hide = () => (chip.hidden = true);
  field.addEventListener("blur", hide, { once: true });
  setTimeout(hide, 8000);
}

function hasPaymentFrames(scope: ParentNode): boolean {
  return [...scope.querySelectorAll("iframe")].some((frame) => isPaymentFrameUrl(frame.src));
}

function formLeading(prompt: FormPrompt): HTMLElement {
  if (prompt.kind === "card") {
    return prompt.brand && prompt.brand !== "card" ? brandMark(prompt.brand) : badge("card");
  }
  if (prompt.country) {
    return flagMark(prompt.country);
  }
  return badge(prompt.random ? "globe" : "map-pin");
}

function formTitle(prompt: FormPrompt): string {
  if (prompt.kind === "card") {
    return t(prompt.update ? "autofill.update_card_title" : "autofill.save_card_title", {
      last4: prompt.last4 ?? "",
    });
  }
  if (prompt.random && !prompt.update) {
    return t("autofill.keep_identity_title", { domain: prompt.domain });
  }
  return t(prompt.update ? "autofill.update_address_title" : "autofill.save_address_title");
}

function formDetail(prompt: FormPrompt): string {
  if (prompt.kind === "address") {
    return prompt.preview ?? "";
  }
  const brand = prompt.brand ? CARD_BRAND_NAMES[prompt.brand] : "";
  return [brand, prompt.expiry].filter(Boolean).join(" · ");
}

function showFormBanner(prompt: FormPrompt): void {
  banner.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = formTitle(prompt);
  const detail = document.createElement("small");
  detail.textContent = formDetail(prompt);
  const text = document.createElement("div");
  text.className = "text";
  text.append(title, detail);

  const cvv = document.createElement("input");
  cvv.type = "checkbox";
  if (prompt.kind === "card" && prompt.hasCvv) {
    const label = document.createElement("label");
    label.className = "check";
    label.append(cvv, t("autofill.save_cvv"));
    text.append(label);
  }

  const never = document.createElement("button");
  never.type = "button";
  never.className = "link";
  never.textContent = t("autofill.never_here");
  text.append(never);

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = t(prompt.update ? "autofill.update" : "autofill.save");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = t("autofill.skip");

  save.addEventListener("click", async (event) => {
    if (!event.isTrusted) {
      return;
    }
    const response = await send({ type: "autofill:form-save", cvv: cvv.checked });
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
    if (!event.isTrusted) {
      return;
    }
    void send({ type: "autofill:form-dismiss" });
    banner.hidden = true;
  });
  never.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    void send({ type: "autofill:form-dismiss", never: true });
    banner.hidden = true;
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(dismiss, save);
  banner.append(formLeading(prompt), text, actions);
  banner.hidden = false;
}

async function captureForm(scope: ParentNode): Promise<void> {
  if (location.protocol !== "https:") {
    return;
  }
  if (passwordFields(scope).some((field) => field.value)) {
    return;
  }
  const fields = detectFields(scope);
  const cardFields = fields.filter((field) => isCardKind(field.kind));
  const placeFields = fields.filter((field) => !isCardKind(field.kind));
  const typedCard = cardFields.some((field) => field.kind === "cc-number" && field.element.value);
  const framed = hasPaymentFrames(scope === document ? document : scope);
  const kind = placeFields[0] ? formKindOf(placeFields[0].element, fields) : null;
  const cardState = fillState(cardFields, filled);
  const placeState = fillState(placeFields, filled);
  const card = typedCard || framed ? readCard(cardFields) : undefined;
  const address =
    kind && (placeState.typed || placeState.random) ? readAddress(placeFields) : undefined;
  if (!card && !address) {
    return;
  }
  const key = JSON.stringify([card, address]);
  if (key === lastFormCapture.key && Date.now() - lastFormCapture.at < 3000) {
    return;
  }
  lastFormCapture = { key, at: Date.now() };
  const response = await send({
    type: "autofill:form-capture",
    ...(card ? { card, untouched: !cardState.typed } : {}),
    ...(address ? { address, random: placeState.random } : {}),
  });
  if (response.ok && "form" in response && response.form) {
    showFormBanner(response.form);
  }
}

document.addEventListener(
  "submit",
  (event) => {
    if (event.target instanceof HTMLFormElement) {
      void captureForm(event.target);
    }
  },
  true,
);
document.addEventListener(
  "click",
  (event) => {
    if (!event.isTrusted) {
      return;
    }
    const button = (event.target as Element | null)?.closest?.(
      'button, input[type="submit"], input[type="button"], [role="button"]',
    );
    if (!button || !isSubmitLike(button)) {
      return;
    }
    const scope = (button as HTMLButtonElement).form ?? button.closest("form") ?? document;
    void captureForm(scope);
  },
  true,
);
document.addEventListener(
  "paste",
  (event) => {
    const target = event.target;
    if (!event.isTrusted || !(target instanceof HTMLInputElement) || target.type !== "password") {
      return;
    }
    void checkSite().then((warning) => warning && showChip(target, warning));
  },
  true,
);
chrome.runtime.onMessage?.addListener((message: unknown) => {
  if ((message as { type?: unknown } | null)?.type === "7key:form-capture") {
    void captureForm(document);
  }
});

async function start(): Promise<void> {
  const { locale } = await chrome.storage.local.get<{ locale?: LocalePreference }>("locale");
  t = createTranslator(resolveLocale(locale));
  trigger.title = t("autofill.trigger");
  trigger.setAttribute("aria-label", trigger.title);
  document.documentElement.append(host);

  const response = await send({ type: "autofill:pending" });
  if (response.ok && "prompt" in response && response.prompt) {
    if (response.prompt.confirmed) {
      showBanner(response.prompt);
    } else {
      watchOutcome([]);
    }
  } else {
    const form = await send({ type: "autofill:form-pending" });
    if (form.ok && "form" in form && form.form) {
      showFormBanner(form.form);
    }
  }

  if (document.activeElement instanceof HTMLInputElement) {
    onFocusIn({ target: document.activeElement } as unknown as FocusEvent);
  }

  scheduleSetupScan();
  new MutationObserver(scheduleSetupScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

void start();
