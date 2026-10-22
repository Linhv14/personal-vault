import { createTranslator, resolveLocale } from "../../src/i18n/index.js";
import type { LocalePreference } from "../../src/i18n/index.js";
import type { AddressData, AutofillRequest, Suggestion } from "../lib/autofill-protocol.js";
import { fromBase64 } from "../../src/core/bytes.js";
import { brandMark, flagMark } from "../../src/ui/marks.js";
import { isPaymentFrameUrl } from "../../src/core/payment-frames.js";
import type { LookalikeMatch } from "../../src/core/lookalike.js";
import { conditionalPasskeys } from "../lib/passkey/conditional.js";
import type { PasskeyOption } from "../lib/passkey/protocol.js";
import {
  findPasswordFor,
  findUsernameField,
  formKind,
  hasPaymentFrames,
  isCodeField,
  isDecoratable,
  isEmailInput,
  isVisible,
  namesAccount,
  passwordFields,
  scopeOf,
  USERNAME_INPUTS,
  wantsNewPassword,
} from "./detect.js";
import { detectFields, formKindOf, isCardKind } from "./forms/classify.js";
import { fillAddress, fillCard } from "./forms/fill.js";
import { countryHint } from "./forms/values.js";
import { fillState, isSubmitLike, readAddress, readCard } from "./form-capture.js";
import { send } from "./send.js";
import { filled, state, t } from "./state.js";
import { setRandomValue, setValue } from "./track.js";
import { fillCode, findSetupQr, findSetupText, mentionsSetup } from "./two-factor.js";
import { showChip } from "./ui/chip.js";
import { showFormBanner } from "./ui/form-banner.js";
import {
  avatar,
  badge,
  closeMenu,
  lockedRow,
  menuHeading,
  menuRow,
  menuRows,
  note,
  showMenu,
} from "./ui/menu.js";
import { banner, host, menu, shadow, trigger } from "./ui/root.js";
import { showBanner } from "./ui/save-banner.js";
import { showTotpBanner } from "./ui/totp-banner.js";
import { fillFrom, placeTrigger } from "./ui/trigger.js";

const OUTCOME_WAIT_MS = 10_000;
const OUTCOME_STABLE_MS = 1_000;
const OUTCOME_POLL_MS = 250;

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

async function openCodeMenu(input: HTMLInputElement, onlyIfUseful: boolean): Promise<void> {
  const response = await send({ type: "autofill:codes" });
  if (state.activeInput !== input) {
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

async function fillCardItem(id: string, input: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:card", id });
  closeMenu();
  if (!response.ok || !("card" in response)) {
    return;
  }
  fillFrom(input, () => fillCard(detectFields(scopeOf(input)), response.card, setValue));
}

async function fillAddressFrom(request: AutofillRequest, input: HTMLInputElement): Promise<void> {
  const response = await send(request);
  closeMenu();
  if (!response.ok || !("identity" in response)) {
    return;
  }
  const data: AddressData = response.identity;
  const random = request.type === "autofill:random-address";
  fillFrom(input, () =>
    fillAddress(detectFields(scopeOf(input)), data, random ? setRandomValue : setValue),
  );
}

async function openFrameCardMenu(frame: HTMLIFrameElement, onlyIfUseful: boolean): Promise<void> {
  const response = await send({ type: "autofill:cards" });
  if (state.cardFrame !== frame) {
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
    if (state.cardFrame !== focused) {
      closeMenu();
    }
    state.activeInput = null;
    state.cardFrame = focused;
    placeTrigger();
    void checkSite();
    if (menu.hidden) {
      void openFrameCardMenu(focused, true);
    }
  }, 0);
}

async function openCardMenu(input: HTMLInputElement, onlyIfUseful: boolean): Promise<void> {
  const response = await send({ type: "autofill:cards" });
  if (state.activeInput !== input) {
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
  if (state.activeInput !== input) {
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
  if (!state.activeInput) {
    return;
  }
  const input = state.activeInput;
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
  if (state.activeInput !== input) {
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

const MAX_SETUP_SCANS = 20;

async function scanForSetup(): Promise<void> {
  if (state.setupScans >= MAX_SETUP_SCANS || !banner.hidden) {
    return;
  }
  if (!mentionsSetup(document.body?.textContent ?? "")) {
    return;
  }
  state.setupScans++;
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
  if (!found || found === state.totpSeen) {
    return;
  }
  state.totpSeen = found;
  const response = await send({ type: "autofill:totp-found", text: found });
  if (response.ok && "totp" in response && response.totp) {
    showTotpBanner(response.totp);
  }
}

function scheduleSetupScan(): void {
  clearTimeout(state.setupTimer);
  state.setupTimer = setTimeout(() => void scanForSetup(), 800);
}

function capturedPassword(scope: ParentNode): string {
  const values = passwordFields(scope)
    .map((field) => field.value)
    .filter(Boolean);
  const repeated = values.find((value, index) => values.indexOf(value) !== index);
  return repeated ?? values.at(-1) ?? "";
}

function rememberIdentifier(scope: ParentNode): void {
  const field = [...scope.querySelectorAll<HTMLInputElement>(USERNAME_INPUTS)].find(
    (input) => isVisible(input) && input.value.trim() && namesAccount(input),
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
  if (password === state.lastCapture.password && Date.now() - state.lastCapture.at < 3000) {
    return;
  }
  state.lastCapture = { password, at: Date.now() };

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
  clearInterval(state.outcomeTimer);
  const deadline = Date.now() + OUTCOME_WAIT_MS;
  let goneSince = 0;
  const stop = (outcome: "confirm" | "dismiss") => {
    clearInterval(state.outcomeTimer);
    state.outcomeTimer = undefined;
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
  state.outcomeTimer = setInterval(() => {
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
  if (!(target instanceof HTMLInputElement) || state.filling || !isDecoratable(target)) {
    return;
  }
  if (state.activeInput !== target) {
    closeMenu();
  }
  state.activeInput = target;
  state.cardFrame = null;
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
  } else if (!state.activeInput && state.cardFrame) {
    void openFrameCardMenu(state.cardFrame, false);
  } else {
    void openMenu({ onlyIfUseful: false });
  }
});

menu.addEventListener("keydown", (event) => {
  const rows = menuRows();
  const index = rows.indexOf(shadow.activeElement as HTMLButtonElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    rows[(index + step + rows.length) % rows.length]?.focus();
  } else if (event.key === "Escape") {
    closeMenu();
    state.activeInput?.focus();
  }
});

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (
      !event.isTrusted ||
      !(target instanceof HTMLInputElement) ||
      state.filling ||
      !isDecoratable(target)
    ) {
      return;
    }
    state.activeInput = target;
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
    if (event.isTrusted && event.target === state.activeInput) {
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
    if (event.target !== state.activeInput) {
      state.activeInput = null;
      state.cardFrame = null;
      trigger.hidden = true;
    }
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
  }
  if (event.key === "ArrowDown" && event.target === state.activeInput && !menu.hidden) {
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

async function checkSite(): Promise<LookalikeMatch | null> {
  if (location.protocol !== "https:") {
    return null;
  }
  const response = await send({ type: "autofill:site-check" });
  const warning = response.ok && "lookalike" in response ? response.lookalike : null;
  const changed = warning?.target !== state.siteWarning?.target;
  state.siteWarning = warning;
  if (changed && !menu.hidden) {
    menu.querySelector(".heading")?.replaceWith(menuHeading());
  }
  return warning;
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
  if (key === state.lastFormCapture.key && Date.now() - state.lastFormCapture.at < 3000) {
    return;
  }
  state.lastFormCapture = { key, at: Date.now() };
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
  state.translate = createTranslator(resolveLocale(locale));
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
