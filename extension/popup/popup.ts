/**
 * The popup — the whole UI of the vault.
 *
 * Everything lives here rather than being split with the service worker,
 * because MV3 terminates that worker after ~30 seconds idle; keeping state
 * there only produces bugs that appear at random.
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
import { fromBase64, toBase64 } from "../../src/core/bytes.js";
import type { Bytes } from "../../src/core/bytes.js";
import {
  generatePassphrase,
  generatePassword,
  generatePin,
  rateStrength,
  type GeneratedSecret,
} from "../../src/core/generator.js";
import {
  buildOtpauthUri,
  generateTotp,
  parseTotpInput,
  secondsRemaining,
  TOTP_DEFAULTS,
  type TotpConfig,
} from "../../src/core/totp.js";
import { buildShareUrl, createShare } from "../../src/core/share.js";
import {
  createTranslator,
  describeError,
  LOCALE_NAMES,
  LOCALES,
  resolveLocale,
  type Locale,
  type LocalePreference,
  type MessageKey,
  type Translate,
} from "../../src/i18n/index.js";
import * as api from "../lib/api.js";
import {
  autofillSupported,
  disableAutofill,
  enableAutofill,
  isAutofillEnabled,
} from "../lib/autofill-permission.js";
import { scheduleClipboardClear } from "../lib/clipboard.js";
import {
  forgetSharedLink,
  loadSharedLinks,
  rememberSharedLink,
  saveSharedLinks,
  type SharedLink,
} from "../lib/shared-links.js";
import { APP_NAME } from "../../src/core/brand.js";
import { hydrateIcons, icon, iconButton, type IconName } from "../../src/ui/icons.js";
import { addRecipients, MAX_SHARE_RECIPIENTS, singleViewAllowed } from "../lib/recipients.js";
import { hydrateBrand, logo, wordmark } from "../../src/ui/logo.js";
import {
  clearAccountData,
  clearPendingSignup,
  AUTO_LOCK_CHOICES,
  DEFAULT_AUTO_LOCK_MINUTES,
  LOCK_ON_BROWSER_CLOSE,
  notePasskeys,
  getLocal,
  getUnlocked,
  loadPendingSignup,
  lock,
  savePendingSignup,
  setLocal,
  touch,
  unlock,
} from "../lib/storage.js";
import {
  decryptAll,
  importKey,
  matchingItems,
  migrateUnboundItems,
  newItemId,
  registrableDomain,
  removeItem,
  saveItem,
  searchItems,
  sync,
  type VaultItem,
} from "../lib/vault.js";
import {
  cardDigits,
  formatCardNumber,
  ITEM_TYPES,
  itemType,
  KIND_LABEL,
  lastFour,
  NEW_LABEL,
  normalizeExpiry,
  TYPE_FIELDS,
  TYPE_ICON,
  TYPE_LABEL,
  type FieldSpec,
  type TextFieldKey,
  type ItemType,
} from "../lib/item-types.js";
import { parseRecoveryCodes } from "../lib/recovery-codes.js";

/**
 * Replaced at build time with the Worker URL of the last deployment, so someone
 * who clones, deploys and loads the extension never has to retype the address
 * of their own server. Undefined in builds made before any deploy.
 */
declare const __VAULT_DEFAULT_SERVER__: string | undefined;

function deployedServerUrl(): string {
  return typeof __VAULT_DEFAULT_SERVER__ === "string" ? __VAULT_DEFAULT_SERVER__ : "";
}

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

const SCREENS = [
  "setup",
  "unlock",
  "list",
  "edit",
  "generator",
  "share",
  "links",
  "settings",
] as const;
type Screen = (typeof SCREENS)[number];

function show(screen: Screen): void {
  for (const name of SCREENS) $(`screen-${name}`).hidden = name !== screen;
  document.body.dataset.screen = screen;
}

let locale: Locale = "en";
let t: Translate = createTranslator("en");

/** Fill every `data-i18n*` element. Runs at boot and whenever the locale changes. */
function applyStaticText(): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n as MessageKey);
  }
  for (const node of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    node.placeholder = t(node.dataset.i18nPlaceholder as MessageKey);
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-app-name]")) {
    node.textContent = APP_NAME;
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    node.title = t(node.dataset.i18nTitle as MessageKey);
    node.setAttribute("aria-label", node.title);
  }
  document.documentElement.lang = locale;
}

function setError(id: string, message: string | null): void {
  const node = $(id);
  node.textContent = message ?? "";
  node.hidden = !message;
}

function showError(id: string, error: unknown): void {
  setError(id, describeError(error, t));
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
 * Copy, then clear the clipboard after 30 seconds. The clipboard is shared with
 * every running application, and several clipboard managers persist history to
 * disk.
 */
async function copy(value: string, what: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast(t("common.copied", { what }));
  await scheduleClipboardClear();
}

let vaultKey: CryptoKey | null = null;
let vaultKeyRaw: Bytes | null = null;
let items: VaultItem[] = [];
let tabUrl: string | undefined;
let clockSkew = 0;

/** Server-corrected clock. TOTP must use this, never `Date.now()` directly. */
function nowMs(): number {
  return Date.now() + clockSkew * 1000;
}

const timers = new Set<number>();
function clearTimers(): void {
  for (const timer of timers) clearInterval(timer);
  timers.clear();
}

hydrateIcons(document);
hydrateBrand(document);

async function boot(): Promise<void> {
  const local = await getLocal();
  locale = resolveLocale(local.locale);
  t = createTranslator(locale);
  applyStaticText();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab?.url;
  clockSkew = local.clockSkew ?? 0;

  if (!local.apiUrl || !local.email) {
    const serverField =
      $<HTMLFormElement>("form-setup").querySelector<HTMLInputElement>('[name="apiUrl"]')!;
    defaultServer = deployedServerUrl();
    serverField.value = local.apiUrl ?? defaultServer;
    customServer = serverField.value !== defaultServer;
    const signup = await loadPendingSignup();
    if (signup) {
      serverField.value = signup.apiUrl;
      customServer = signup.apiUrl !== defaultServer;
      setupField("email").value = signup.email;
      setupField("registrationToken").value = signup.registrationToken;
      codeSentTo = signup.email;
    }
    void serverConfigFor(serverField.value);
    show("setup");
    if (signup) await showSetupForm("register");
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
  vaultKeyRaw = fromBase64(rawBase64);
  vaultKey = await importKey(rawBase64);
  items = await decryptAll(vaultKey, locale);
  void notePasskeys(items.some((item) => item.passkey));
  renderList();
  show("list");
  void backgroundSync();
  void refreshAutofillPromo();
}

async function refreshAutofillPromo(): Promise<void> {
  const { autofillPromoDismissed } = await getLocal();
  const showPromo = autofillSupported() && !autofillPromoDismissed && !(await isAutofillEnabled());
  $("autofill-promo").hidden = !showPromo;
  if (showPromo) await setLocal({ autofillPromoDismissed: true });
}

async function turnOnAutofill(): Promise<boolean> {
  const enabled = await enableAutofill();
  if (enabled) toast(t("settings.autofill_enabled"));
  return enabled;
}

$("autofill-promo-enable").addEventListener("click", async () => {
  if (await turnOnAutofill()) $("autofill-promo").hidden = true;
});
$("autofill-promo-close").addEventListener("click", async () => {
  $("autofill-promo").hidden = true;
  await setLocal({ autofillPromoDismissed: true });
});

const SYNC_BAR_DELAY_MS = 300;

function showSyncProblem(kind: "offline" | "failed" | null, message = ""): void {
  const notice = $("sync-notice");
  notice.hidden = kind === null;
  notice.classList.toggle("failed", kind === "failed");
  notice.replaceChildren(icon(kind === "failed" ? "alert" : "cloud-off"), message);
}

async function backgroundSync(): Promise<void> {
  const bar = setTimeout(() => ($("sync-bar").hidden = false), SYNC_BAR_DELAY_MS);
  try {
    const synced = await sync();
    if (synced === null) {
      showSyncProblem("offline", t("list.offline"));
    } else {
      showSyncProblem(null);
      const changed = synced + (vaultKey ? await migrateUnboundItems(vaultKey) : 0);
      if (changed > 0 && vaultKey) {
        items = await decryptAll(vaultKey, locale);
        void notePasskeys(items.some((item) => item.passkey));
        renderList();
      }
    }
  } catch (error) {
    showSyncProblem("failed", describeError(error, t));
  } finally {
    clearTimeout(bar);
    $("sync-bar").hidden = true;
  }

  const skew = await api.measureClockSkew();
  if (skew === null) return;

  clockSkew = skew;
  await setLocal({ clockSkew: skew });

  const warning = $("clock-warning");
  // Ten seconds is already worth flagging: codes start failing near a rollover.
  if (Math.abs(skew) > 10) {
    warning.textContent = t("list.clock_skew", {
      direction: t(skew > 0 ? "list.clock_behind" : "list.clock_ahead"),
      seconds: Math.abs(skew),
    });
    warning.hidden = false;
  } else {
    warning.hidden = true;
  }
}

let defaultServer = "";
let customServer = false;

$("setup-custom-server").addEventListener("click", () => {
  customServer = true;
  renderSetupForm();
  setupField("apiUrl").focus();
});

let setupMode: "register" | "login" = "register";
let registrationOpen = false;
let verificationRequired = false;
let codeSentTo: string | null = null;

function setupField(name: string): HTMLInputElement {
  return $<HTMLFormElement>("form-setup").querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}

function showSetupField(name: string, visible: boolean): void {
  const field = setupField(name);
  field.required = visible;
  field.closest("label")!.hidden = !visible;
}

function awaitingCode(): boolean {
  return setupMode === "register" && verificationRequired && codeSentTo !== null;
}

function setupButtonLabel(): string {
  if (setupMode === "login") return t("setup.sign_in");
  return verificationRequired && !codeSentTo ? t("setup.send_code") : t("setup.create");
}

/**
 * Creating a vault and signing in on a second machine are presented as two
 * visible choices rather than one form with a link underneath.
 *
 * Signing in needs no registration token — that token exists only to stop
 * strangers creating accounts. Hiding the sign-in path behind a link led people
 * setting up a new machine to believe they needed a token they do not have.
 */
function renderSetupForm(): void {
  const registering = setupMode === "register";
  const codeStep = awaitingCode();
  const askPassword = !registering || !verificationRequired || codeStep;

  const askServer = (customServer || !defaultServer) && !codeStep;
  $("setup-server-field").hidden = !askServer;
  $("setup-custom-server").hidden = askServer || codeStep || !defaultServer;
  showSetupField("email", !codeStep);
  showSetupField("registrationToken", registering && !registrationOpen && !codeStep);
  showSetupField("password", askPassword);
  showSetupField("confirm", askPassword && registering);

  $("setup-code-field").hidden = !codeStep;
  setupField("verificationCode").required = codeStep;
  $("setup-code-hint").textContent = codeStep ? t("setup.code_sent", { email: codeSentTo! }) : "";

  const password = setupField("password");
  password.autocomplete = registering ? "new-password" : "current-password";
  password.minLength = registering ? 12 : 0;

  $("setup-hint").textContent = t("setup.hint_create");
  $("setup-hint").hidden = !(registering && askPassword);
  $("setup-form-title").textContent = t(registering ? "setup.mode_create" : "setup.mode_signin");
  $<HTMLFormElement>("form-setup").querySelector("button.primary")!.textContent =
    setupButtonLabel();
}

async function leaveCodeStep(): Promise<void> {
  codeSentTo = null;
  await clearPendingSignup();
  renderSetupForm();
}

function serverFieldValue(): string {
  return $<HTMLFormElement>("form-setup")
    .querySelector<HTMLInputElement>('[name="apiUrl"]')!
    .value.trim();
}

let serverConfigRequest: { url: string; config: Promise<api.ServerConfig> } | null = null;

function serverConfigFor(url: string): Promise<api.ServerConfig> {
  if (serverConfigRequest?.url !== url) {
    serverConfigRequest = { url, config: api.serverConfig(url) };
  }
  return serverConfigRequest.config;
}

async function applyServerConfig(): Promise<void> {
  const config = await serverConfigFor(serverFieldValue());
  registrationOpen = config.registrationOpen;
  verificationRequired = config.emailVerification;
}

async function showSetupForm(mode: "register" | "login"): Promise<void> {
  await applyServerConfig();
  setupMode = mode;
  renderSetupForm();
  setError("setup-error", null);
  $("setup-choice").hidden = true;
  $("setup-form-wrap").hidden = false;
  setupField(awaitingCode() ? "verificationCode" : "email").focus();
}

$<HTMLFormElement>("form-setup")
  .querySelector<HTMLInputElement>('[name="apiUrl"]')!
  .addEventListener("change", async () => {
    await applyServerConfig();
    renderSetupForm();
  });

$("setup-mode-create").addEventListener("click", () => void showSetupForm("register"));
$("setup-mode-signin").addEventListener("click", () => void showSetupForm("login"));
$("setup-back").addEventListener("click", async () => {
  await leaveCodeStep();
  $("setup-form-wrap").hidden = true;
  $("setup-choice").hidden = false;
});

$("setup-code-change-email").addEventListener("click", async () => {
  await leaveCodeStep();
  setupField("email").focus();
});

$<HTMLFormElement>("form-setup").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("setup-error", null);

  if (!codeSentTo) {
    const required = verificationRequired;
    await applyServerConfig();
    if (verificationRequired !== required) {
      renderSetupForm();
      return;
    }
  }

  const data = new FormData(event.target as HTMLFormElement);
  const apiUrl = String(data.get("apiUrl")).trim().replace(/\/$/, "");
  const email = String(data.get("email")).trim().toLowerCase();
  const password = String(data.get("password"));

  if (setupMode === "register" && password !== String(data.get("confirm"))) {
    setError("setup-error", t("setup.password_mismatch"));
    return;
  }

  const button = (event.target as HTMLFormElement).querySelector<HTMLButtonElement>(
    "button.primary",
  )!;
  button.textContent = t("setup.working");
  button.disabled = true;

  try {
    if (setupMode === "register" && verificationRequired && !codeSentTo) {
      await api.requestVerificationCode(apiUrl, email, locale);
      const registrationToken = String(data.get("registrationToken") ?? "");
      await savePendingSignup({ apiUrl, email, registrationToken, sentAt: Date.now() });
      codeSentTo = email;
      renderSetupForm();
      setupField("verificationCode").focus();
      return;
    }
    await setLocal({ apiUrl, email });
    if (setupMode === "register") {
      const { record } = await createAccount(email, password);
      const { token } = await api.register(
        email,
        record,
        String(data.get("registrationToken")),
        verificationRequired ? String(data.get("verificationCode")).trim() : undefined,
      );
      await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
      await clearPendingSignup();
      await finishUnlock(email, password, record.kdf, record.wrappedVaultKey, token);
    } else {
      await doLogin(email, password);
    }
  } catch (error) {
    if (!(await getLocal()).wrappedVaultKey) await chrome.storage.local.remove("email");
    showError("setup-error", error);
  } finally {
    button.textContent = setupButtonLabel();
    button.disabled = false;
  }
});

$("setup-code-resend").addEventListener("click", async () => {
  setError("setup-error", null);
  const signup = await loadPendingSignup();
  if (!signup) {
    await leaveCodeStep();
    return;
  }
  try {
    await api.requestVerificationCode(signup.apiUrl, signup.email, locale);
    await savePendingSignup({ ...signup, sentAt: Date.now() });
    toast(t("setup.code_resent"));
  } catch (error) {
    showError("setup-error", error);
  }
});

$<HTMLFormElement>("form-unlock").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("unlock-error", null);

  const password = String(new FormData(event.target as HTMLFormElement).get("password"));
  const button = (event.target as HTMLFormElement).querySelector<HTMLButtonElement>(
    "button.primary",
  )!;
  button.textContent = t("unlock.working");
  button.disabled = true;

  try {
    const { email } = await getLocal();
    await doLogin(email!, password);
  } catch (error) {
    showError("unlock-error", error);
  } finally {
    button.textContent = t("unlock.submit");
    button.disabled = false;
  }
});

/**
 * Unlock, working offline when needed.
 *
 * Online it refreshes the KDF params first, so a password changed on another
 * machine still opens here. Offline it falls back to the cached params and
 * wrapped key, which is enough to decrypt everything already synced.
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
    // Only a network failure may fall through to the cache. A rejected password
    // must surface now, not later disguised as something else.
    const offline = error instanceof api.ApiError && error.status === 0;
    if (!offline || !kdf || !wrapped) throw error;
    toast(t("unlock.offline"));
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
  const raw = await openSealed(wrappingKey, wrapped);

  await unlock(toBase64(raw), token);
  await enterVault(toBase64(raw));
}

$("unlock-reset").addEventListener("click", async () => {
  if (!confirm(t("unlock.reset_confirm"))) return;
  await clearAccountData();
  await lock();
  location.reload();
});

$("search").addEventListener("input", () => renderList());
$("btn-add").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleAddMenu();
});
$("btn-generator").addEventListener("click", () => openGenerator());
$("btn-settings").addEventListener("click", () => void openSettings());
$("btn-lock").addEventListener("click", async () => {
  await lock();
  location.reload();
});

let typeFilter: ItemType | "all" = "all";

function renderTypeFilter(): void {
  const counts = new Map<ItemType, number>();
  for (const item of items) counts.set(itemType(item), (counts.get(itemType(item)) ?? 0) + 1);
  const chip = (value: ItemType | "all", label: string, count: number) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = count === 0 ? "type-chip empty" : "type-chip";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(typeFilter === value));
    const name = document.createElement("span");
    name.textContent = label;
    const total = document.createElement("span");
    total.className = "type-count";
    total.textContent = String(count);
    button.append(name, total);
    button.addEventListener("click", () => {
      typeFilter = value;
      renderList();
    });
    return button;
  };
  $("type-filter").replaceChildren(
    chip("all", t("type.all"), items.length),
    ...ITEM_TYPES.map((type) => chip(type, t(TYPE_LABEL[type]), counts.get(type) ?? 0)),
  );
  $("type-filter").hidden = items.length === 0;
}

function renderList(): void {
  clearTimers();
  void touch();

  const query = $<HTMLInputElement>("search").value;
  const ofType =
    typeFilter === "all" ? items : items.filter((item) => itemType(item) === typeFilter);
  const visible = searchItems(ofType, query);
  const showMatches = !query && (typeFilter === "all" || typeFilter === "login");
  const matched = showMatches ? matchingItems(visible, tabUrl) : [];
  const matchedIds = new Set(matched.map((item) => item.id));

  renderTypeFilter();
  if (matched.length > 0) {
    $("matching-title").textContent = t("list.matching_for", {
      domain: registrableDomain(tabUrl ?? "") ?? "",
    });
    renderInto($("matching-list"), matched);
    $("matching-section").hidden = false;
  } else {
    $("matching-section").hidden = true;
  }

  const rest = visible.filter((item) => !matchedIds.has(item.id));
  $("all-title").hidden = rest.length === 0 || (!query && matched.length === 0);
  $("all-title").textContent = query
    ? t("list.results", { count: rest.length })
    : t(typeFilter === "all" ? "list.all" : TYPE_LABEL[typeFilter]);
  renderInto($("all-list"), rest);

  $("list-empty").hidden = items.length > 0;
  const emptyType = items.length > 0 && visible.length === 0;
  $("list-empty-type").hidden = !emptyType;
  const addOfType = $("list-add-type");
  addOfType.hidden = !emptyType || typeFilter === "all" || query !== "";
  if (typeFilter !== "all") addOfType.textContent = t(NEW_LABEL[typeFilter]);
}

function toggleAddMenu(): void {
  const menu = $("add-menu");
  if (!menu.hidden) {
    menu.hidden = true;
    return;
  }
  menu.replaceChildren(
    ...ITEM_TYPES.map((type) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "add-option";
      option.setAttribute("role", "menuitem");
      option.append(typeBadge(type), t(KIND_LABEL[type]));
      option.addEventListener("click", () => {
        menu.hidden = true;
        openEditor(null, type);
      });
      return option;
    }),
  );
  menu.hidden = false;
  menu.querySelector("button")?.focus();
}

document.addEventListener("click", (event) => {
  if (!$("add-menu").contains(event.target as Node)) $("add-menu").hidden = true;
});
$("list-add-type").addEventListener("click", () => {
  if (typeFilter !== "all") openEditor(null, typeFilter);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("add-menu").hidden = true;
});

function renderInto(container: HTMLElement, list: VaultItem[]): void {
  container.replaceChildren(...list.map(renderItem));
}

const AVATAR_HUES = [210, 260, 330, 20, 150, 190, 40, 290];

function avatar(title: string): HTMLElement {
  const node = document.createElement("span");
  node.className = "avatar";
  const letter = [...title.trim()][0]?.toUpperCase() ?? "?";
  const hash = [...title].reduce((sum, char) => sum + char.codePointAt(0)!, 0);
  node.style.background = `hsl(${AVATAR_HUES[hash % AVATAR_HUES.length]} 55% 48%)`;
  node.textContent = letter;
  return node;
}

function typeBadge(type: ItemType): HTMLElement {
  const node = document.createElement("span");
  node.className = `avatar type-badge type-${type}`;
  node.append(icon(TYPE_ICON[type]));
  return node;
}

function itemSubtitle(item: VaultItem): string {
  switch (itemType(item)) {
    case "login":
      return item.username || (item.url ? (registrableDomain(item.url) ?? item.url) : "");
    case "card": {
      const digits = lastFour(item.cardNumber);
      return [item.cardholder, digits && t("item.card_ending", { digits })]
        .filter(Boolean)
        .join(" · ");
    }
    case "identity":
      return [item.fullName, item.city].filter(Boolean).join(" · ");
    case "recovery":
      return t("item.codes_count", { count: item.codes?.length ?? 0 });
    case "wifi":
      return item.ssid ?? "";
    case "note":
      return (item.note ?? "").split("\n")[0] ?? "";
  }
}

function copyAction(name: IconName, label: MessageKey, what: string, value: string): HTMLElement {
  return iconButton(name, t(label), () => copy(value, what.toLowerCase()));
}

function quickAction(item: VaultItem): HTMLElement[] {
  const password = item.password
    ? [copyAction("key", "item.copy_password", t("common.password"), item.password)]
    : [];
  switch (itemType(item)) {
    case "login":
      return [...(item.totp ? [totpChip(item.totp)] : []), ...password];
    case "card":
      return item.cardNumber
        ? [
            copyAction(
              "card",
              "item.copy_card_number",
              t("field.card_number"),
              cardDigits(item.cardNumber),
            ),
          ]
        : [];
    case "wifi":
      return password;
    default:
      return [];
  }
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
  // textContent everywhere, never innerHTML: item fields are user input.
  title.textContent = item.title;
  const sub = document.createElement("div");
  sub.className = "item-sub";
  sub.textContent = itemSubtitle(item);
  name.append(title, sub);
  const type = itemType(item);
  head.append(type === "login" ? avatar(item.title) : typeBadge(type), name, ...quickAction(item));

  const body = document.createElement("div");
  body.className = "item-body";
  body.hidden = true;

  head.addEventListener("click", () => {
    body.hidden = !body.hidden;
    wrap.classList.toggle("open", !body.hidden);
    if (!body.hidden && body.childElementCount === 0) fillItemBody(body, item);
    void touch();
  });

  wrap.append(head, body);
  return wrap;
}

function actionButton(name: "pencil" | "share", label: string, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.append(icon(name), label);
  button.addEventListener("click", onClick);
  return button;
}

function detailRows(spec: FieldSpec, item: VaultItem): HTMLElement[] {
  const label = t(spec.label);
  if (spec.key === "totp") return item.totp ? [totpRow(item.totp)] : [];
  if (spec.key === "codes") return item.codes?.length ? [codesGrid(item.codes)] : [];
  const value = item[spec.key];
  if (!value) return [];
  switch (spec.kind) {
    case "password":
    case "secret":
      return [valueRow(label, value, true)];
    case "cardNumber":
      return [valueRow(label, formatCardNumber(value), true, `•••• ${lastFour(value)}`)];
    default:
      return [valueRow(label, value, false)];
  }
}

function codesGrid(codes: string[]): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "codes-grid";
  codes.forEach((code, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code mono";
    button.title = `${t("item.code", { number: index + 1 })} · ${t("common.copy")}`;
    button.textContent = code;
    button.addEventListener(
      "click",
      () => void copy(code, t("item.code", { number: index + 1 }).toLowerCase()),
    );
    grid.append(button);
  });
  return grid;
}

function fillItemBody(body: HTMLElement, item: VaultItem): void {
  const type = itemType(item);
  for (const spec of TYPE_FIELDS[type]) body.append(...detailRows(spec, item));
  if (item.passkey) {
    const value = document.createElement("span");
    value.className = "v";
    value.textContent = t("item.passkey_saved", { site: item.passkey.rpId });
    body.append(fieldBlock(t("common.passkey"), value));
  }

  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.append(actionButton("pencil", t("edit.edit_title"), () => openEditor(item)));
  if (type === "login") {
    actions.append(actionButton("share", t("share.title"), () => void openShare(item)));
  }
  body.append(actions);
}

function fieldBlock(label: string, valueNode: HTMLElement): HTMLElement {
  const field = document.createElement("div");
  field.className = "field";
  const key = document.createElement("span");
  key.className = "k";
  key.textContent = label;
  field.append(key, valueNode);
  return field;
}

function copyableRow(label: string, valueNode: HTMLElement, onCopy: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "item-row";
  row.title = t("common.copy");
  row.append(fieldBlock(label, valueNode));
  row.addEventListener("click", onCopy);
  return row;
}

function valueRow(
  label: string,
  value: string,
  secret: boolean,
  masked = "•".repeat(Math.min(value.length, 12)),
): HTMLElement {
  const valueNode = document.createElement("span");
  valueNode.className = secret ? "v mono" : "v";
  valueNode.textContent = secret ? masked : value;
  const row = copyableRow(label, valueNode, () => copy(value, label.toLowerCase()));

  if (secret) {
    let revealed = false;
    const toggle = iconButton("eye", t("common.show"), () => {
      revealed = !revealed;
      valueNode.textContent = revealed ? value : masked;
      toggle.replaceChildren(icon(revealed ? "eye-off" : "eye"));
      toggle.title = t(revealed ? "common.hide" : "common.show");
    });
    row.append(toggle);
  }

  row.append(iconButton("copy", t("common.copy"), () => copy(value, label.toLowerCase())));
  return row;
}

/** Live 2FA code. No network involved — computed locally per RFC 6238. */
function liveTotp(
  config: TotpConfig,
  ringRadius: number,
  ringSize: number,
): { node: HTMLElement; current: () => string } {
  const period = config.period || 30;
  const container = document.createElement("span");
  container.className = "totp-row";
  const ring = createRing(ringRadius, ringSize);
  const code = document.createElement("span");
  code.className = "totp-code";
  code.textContent = "··· ···";
  container.append(ring.svg, code);

  let current = "";
  let lastCounter = -1;
  const tick = async (): Promise<void> => {
    const remaining = secondsRemaining(period, nowMs());
    ring.update(remaining / period);
    ring.svg.classList.toggle("urgent", remaining <= 5);

    const counter = Math.floor(nowMs() / 1000 / period);
    if (counter === lastCounter) return;
    lastCounter = counter;
    try {
      current = await generateTotp(config, nowMs());
      code.textContent = current.replace(/(\d{3})(?=\d)/, "$1 ");
    } catch {
      code.textContent = "—";
    }
  };

  void tick();
  timers.add(setInterval(() => void tick(), 1000) as unknown as number);
  return { node: container, current: () => current };
}

function copyTotp(current: string): void {
  if (current) void copy(current, t("common.totp"));
}

function totpChip(config: TotpConfig): HTMLElement {
  const live = liveTotp(config, 6, 14);
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "totp-chip";
  chip.title = t("item.copy_totp");
  chip.setAttribute("aria-label", chip.title);
  chip.append(live.node);
  chip.addEventListener("click", (event) => {
    event.stopPropagation();
    copyTotp(live.current());
  });
  return chip;
}

function totpRow(config: TotpConfig): HTMLElement {
  const live = liveTotp(config, 9, 22);
  const onCopy = () => copyTotp(live.current());
  const row = copyableRow(t("common.totp"), live.node, onCopy);
  row.append(iconButton("copy", t("common.copy"), onCopy));
  return row;
}

function createRing(
  radius: number,
  size: number,
): { svg: SVGSVGElement; update: (ratio: number) => void } {
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ring");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

  const make = (className: string): SVGCircleElement => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", className);
    circle.setAttribute("cx", String(center));
    circle.setAttribute("cy", String(center));
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

let editing: VaultItem | null = null;
let editingType: ItemType = "login";

function editInput(
  spec: FieldSpec,
  item: VaultItem | null,
): HTMLInputElement | HTMLTextAreaElement {
  const value = (): string => {
    if (!item) {
      return spec.key === "url" && tabUrl ? (registrableDomain(tabUrl) ?? "") : "";
    }
    if (spec.key === "totp") return item.totp ? totpFieldValue(item.totp) : "";
    if (spec.key === "codes") return (item.codes ?? []).join("\n");
    const raw = item[spec.key] ?? "";
    return spec.kind === "cardNumber" ? formatCardNumber(raw) : raw;
  };

  if (spec.kind === "multiline" || spec.kind === "codes") {
    const area = document.createElement("textarea");
    area.name = spec.key;
    area.rows = spec.kind === "codes" ? 6 : editingType === "note" ? 8 : 2;
    area.value = value();
    if (spec.kind === "codes") {
      area.className = "mono";
      area.addEventListener("paste", () => {
        setTimeout(() => {
          const codes = parseRecoveryCodes(area.value);
          if (codes.length > 0) area.value = codes.join("\n");
        });
      });
    }
    return area;
  }

  const input = document.createElement("input");
  input.name = spec.key;
  input.autocomplete = "off";
  input.value = value();
  switch (spec.kind) {
    case "email":
    case "tel":
      input.type = spec.kind;
      break;
    case "url":
      input.placeholder = "example.com";
      break;
    case "password":
    case "secret":
      input.type = "password";
      break;
    case "totp":
      input.placeholder = t("edit.totp_placeholder");
      break;
    case "cardNumber":
      input.inputMode = "numeric";
      input.className = "mono";
      break;
    case "expiry":
      input.inputMode = "numeric";
      input.placeholder = "MM/YY";
      break;
    case "text":
      break;
  }
  return input;
}

function fieldAction(action: string, name: IconName, title: MessageKey): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.dataset["action"] = action;
  button.title = t(title);
  button.append(icon(name));
  return button;
}

function editField(spec: FieldSpec, item: VaultItem | null): HTMLElement[] {
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = t(spec.label);
  const input = editInput(spec, item);

  const actions: HTMLButtonElement[] = [];
  if (spec.kind === "password" || spec.kind === "secret") {
    actions.push(fieldAction("reveal", "eye", "common.show"));
  }
  if (spec.kind === "password") actions.push(fieldAction("generate", "refresh", "edit.regenerate"));
  if (spec.kind === "totp") actions.push(fieldAction("scan", "scan", "edit.scan"));

  if (actions.length === 0) {
    label.append(caption, input);
  } else {
    const wrap = document.createElement("span");
    wrap.className = "field-with-actions";
    wrap.append(input, ...actions);
    label.append(caption, wrap);
  }

  const extra: HTMLElement[] = [];
  if (spec.kind === "totp") {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.id = "edit-totp-hint";
    hint.hidden = true;
    extra.push(hint);
  }
  if (spec.kind === "codes") {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = t("field.codes_hint");
    extra.push(hint);
  }
  return [label, ...extra];
}

function openEditor(
  item: VaultItem | null,
  type: ItemType = item ? itemType(item) : "login",
): void {
  clearTimers();
  editing = item;
  editingType = type;
  setError("edit-error", null);

  const form = $<HTMLFormElement>("form-edit");
  form.reset();
  $("edit-title").textContent = t(item ? "edit.edit_title" : NEW_LABEL[type]);
  $("edit-delete").hidden = !item;
  editInputNamed("title").value = item?.title ?? "";
  $("edit-fields").replaceChildren(...TYPE_FIELDS[type].flatMap((spec) => editField(spec, item)));

  show("edit");
  editInputNamed("title").focus();
}

function editInputNamed(name: string): HTMLInputElement {
  const field = $<HTMLFormElement>("form-edit").elements.namedItem(name);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Missing field ${name}`);
  return field;
}

function totpFieldValue(config: TotpConfig): string {
  const usesDefaults =
    config.algorithm === TOTP_DEFAULTS.algorithm &&
    config.digits === TOTP_DEFAULTS.digits &&
    config.period === TOTP_DEFAULTS.period;
  return usesDefaults ? config.secret : buildOtpauthUri(config);
}

$("edit-back").addEventListener("click", () => {
  renderList();
  show("list");
});

$("edit-fields").addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
  const field = button?.parentElement?.querySelector("input");
  if (!button || !field) return;
  switch (button.dataset["action"]) {
    case "reveal": {
      field.type = field.type === "password" ? "text" : "password";
      const hidden = field.type === "password";
      button.replaceChildren(icon(hidden ? "eye" : "eye-off"));
      button.title = t(hidden ? "common.show" : "common.hide");
      break;
    }
    case "generate": {
      const generated = generatePassword({ length: 20 });
      field.value = generated.value;
      field.type = "text";
      toast(formatEntropy(generated));
      break;
    }
    case "scan":
      void scanTotp(field);
      break;
  }
});

/**
 * Read a 2FA QR code from a screenshot of the open tab.
 *
 * Uses Chrome's built-in `BarcodeDetector` rather than bundling a QR library:
 * that library would sit in the path of the TOTP secret — it sees the secret
 * before you do — so it is a bad place to add a dependency. Where the API is
 * missing, pasting by hand still works and always will.
 */
function setScanHint(text: string, failed = false): void {
  const hint = document.getElementById("edit-totp-hint");
  if (!hint) return;
  hint.textContent = text;
  hint.hidden = text === "";
  hint.classList.toggle("error-text", failed);
}

function pngFromDataUrl(dataUrl: string): Blob {
  return new Blob([fromBase64(dataUrl.slice(dataUrl.indexOf(",") + 1))], { type: "image/png" });
}

async function scanTotp(field: HTMLInputElement): Promise<void> {
  if (!("BarcodeDetector" in self)) {
    setScanHint(t("edit.scan_unsupported"), true);
    return;
  }

  setScanHint(t("edit.scanning"));
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const bitmap = await createImageBitmap(pngFromDataUrl(dataUrl));

    const Detector = (
      self as unknown as {
        BarcodeDetector: new (options: { formats: string[] }) => {
          detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
        };
      }
    ).BarcodeDetector;
    const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);

    const otpauth = codes.find((code) => code.rawValue.toLowerCase().startsWith("otpauth://"));
    if (!otpauth) {
      setScanHint(t(codes.length ? "edit.scan_not_qr" : "edit.scan_none"), true);
      return;
    }

    field.value = otpauth.rawValue;
    const config = parseTotpInput(otpauth.rawValue);
    const titleField = editInputNamed("title");
    if (config.issuer && !titleField.value) titleField.value = config.issuer;

    setScanHint(
      t("edit.scan_ok", {
        issuer: config.issuer ? t("edit.scan_ok_issuer", { issuer: config.issuer }) : "",
        code: await generateTotp(config, nowMs()),
      }),
    );
  } catch (error) {
    console.warn("QR scan failed:", error);
    setScanHint(t("edit.scan_capture_failed"), true);
  }
}

type EditedFields = Partial<Pick<VaultItem, TextFieldKey | "totp" | "codes">>;

function readEditedFields(data: FormData): EditedFields {
  const text = (key: string, trim = true): string | undefined => {
    const raw = String(data.get(key) ?? "");
    return (trim ? raw.trim() : raw) || undefined;
  };
  const fields: EditedFields = {};
  for (const spec of TYPE_FIELDS[editingType]) {
    const { key } = spec;
    if (key === "totp") {
      const raw = text(key);
      fields.totp = raw ? parseTotpInput(raw, text("username")) : undefined;
      continue;
    }
    if (key === "codes") {
      const codes = parseRecoveryCodes(String(data.get(key) ?? ""));
      fields.codes = codes.length > 0 ? codes : undefined;
      continue;
    }
    switch (spec.kind) {
      case "cardNumber":
        fields[key] = cardDigits(text(key)) || undefined;
        break;
      case "expiry": {
        const raw = text(key);
        const expiry = raw ? normalizeExpiry(raw) : undefined;
        if (expiry === null) throw new InvalidField("edit.expiry_invalid");
        fields[key] = expiry;
        break;
      }
      case "password":
      case "secret":
        fields[key] = text(key, false);
        break;
      default:
        fields[key] = text(key);
    }
  }
  return fields;
}

class InvalidField extends Error {
  constructor(readonly messageKey: MessageKey) {
    super(messageKey);
  }
}

$<HTMLFormElement>("form-edit").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("edit-error", null);

  const data = new FormData(event.target as HTMLFormElement);
  let fields: EditedFields;
  try {
    fields = readEditedFields(data);
  } catch (error) {
    setError(
      "edit-error",
      error instanceof InvalidField
        ? t(error.messageKey)
        : t("edit.totp_parse_failed", { reason: describeError(error, t) }),
    );
    return;
  }

  if (!vaultKey) return;

  try {
    const wasEditing = editing !== null;
    await saveItem(vaultKey, {
      ...editing,
      id: editing?.id ?? newItemId(),
      type: editingType,
      title: String(data.get("title")).trim(),
      ...fields,
    });
    items = await decryptAll(vaultKey, locale);
    renderList();
    show("list");
    toast(t(wasEditing ? "edit.saved" : "edit.added"));
  } catch (error) {
    showError("edit-error", error);
  }
});

$("edit-delete").addEventListener("click", async () => {
  if (!editing || !vaultKey) return;
  if (!confirm(t("edit.delete_confirm", { title: editing.title }))) return;

  try {
    await removeItem(editing.id);
    items = await decryptAll(vaultKey, locale);
    renderList();
    show("list");
    toast(t("edit.deleted"));
  } catch (error) {
    showError("edit-error", error);
  }
});

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

// Scoped to the generator screen: the setup screen reuses the .tab style, and
// an unscoped selector would wire its buttons to this handler as well.
for (const tab of document.querySelectorAll<HTMLButtonElement>("#screen-generator .tab")) {
  tab.addEventListener("click", () => {
    genMode = tab.dataset.mode as GenMode;
    for (const other of document.querySelectorAll("#screen-generator .tab")) {
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
$("gen-copy").addEventListener(
  "click",
  () => void copy($("gen-value").textContent ?? "", t("common.password").toLowerCase()),
);

function formatEntropy(result: GeneratedSecret): string {
  return t("gen.entropy", {
    bits: result.entropyBits,
    strength: t(`strength.${rateStrength(result.entropyBits)}` as MessageKey),
  });
}

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
    $("gen-entropy").textContent = describeError(error, t);
    return;
  }

  $("gen-value").textContent = result.value;
  const strength = rateStrength(result.entropyBits);
  $("gen-entropy").textContent = t(`strength.${strength}` as MessageKey);
  $("gen-entropy").title = formatEntropy(result);
  const meter = $("gen-meter");
  meter.dataset.strength = strength;
  meter.style.width = `${Math.min(100, (result.entropyBits / 128) * 100)}%`;
}

let sharing: VaultItem | null = null;
let shareRecipients: string[] = [];

function shareForm(): HTMLFormElement {
  return $<HTMLFormElement>("form-share");
}

function checkedOption(name: string): HTMLInputElement {
  return shareForm().querySelector<HTMLInputElement>(`[name="${name}"]:checked`)!;
}

function optionLabel(input: HTMLInputElement): string {
  return input.closest("label")!.textContent!.trim();
}

function restrictedToEmails(): boolean {
  return !$("share-access-group").hidden && checkedOption("access").value === "emails";
}

function chip(iconName: IconName, text: string): HTMLElement {
  const node = document.createElement("span");
  node.className = "chip";
  const label = document.createElement("span");
  label.className = "chip-text";
  label.textContent = text;
  node.append(icon(iconName), label);
  return node;
}

function renderShareSubject(item: VaultItem): void {
  const name = document.createElement("div");
  name.className = "item-name";
  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = item.title;
  const sub = document.createElement("div");
  sub.className = "item-sub";
  sub.textContent = item.url ? (registrableDomain(item.url) ?? item.url) : (item.username ?? "");
  name.append(title, sub);
  $("share-subject").replaceChildren(avatar(item.title), name);
}

function renderShareFields(item: VaultItem): void {
  const fields: [boolean, MessageKey][] = [
    [Boolean(item.url), "common.url"],
    [Boolean(item.username), "common.username"],
    [Boolean(item.password), "common.password"],
    [Boolean(item.totp), "common.totp"],
  ];
  $("share-fields").replaceChildren(
    ...fields.filter(([shared]) => shared).map(([, key]) => chip("check", t(key))),
  );
}

function renderRecipients(): void {
  const container = $("share-recipients");
  const entry = $<HTMLInputElement>("share-recipient-entry");
  const chips = shareRecipients.map((email) => {
    const node = chip("mail", email);
    const remove = iconButton("close", t("share.remove_recipient", { email }), () => {
      shareRecipients = shareRecipients.filter((other) => other !== email);
      renderRecipients();
      entry.focus();
    });
    node.append(remove);
    return node;
  });
  container.replaceChildren(...chips, entry);
  entry.disabled = shareRecipients.length >= MAX_SHARE_RECIPIENTS;
  $("share-recipients-count").textContent = `${shareRecipients.length}/${MAX_SHARE_RECIPIENTS}`;
  syncShareForm();
}

function setRecipientsHint(message: string | null): void {
  const hint = $("share-recipients-hint");
  hint.textContent = message ?? t("share.recipients_hint");
  hint.classList.toggle("warn-text", message !== null);
  $("share-recipients").setAttribute("aria-invalid", String(message !== null));
}

function commitRecipientEntry(): boolean {
  const entry = $<HTMLInputElement>("share-recipient-entry");
  if (!entry.value.trim()) return true;
  const update = addRecipients(shareRecipients, entry.value);
  shareRecipients = update.recipients;
  entry.value = update.rejected.join(", ");
  setRecipientsHint(
    update.rejected.length > 0
      ? t("share.recipients_invalid", { emails: update.rejected.join(", ") })
      : update.overflow
        ? t("share.recipients_full")
        : null,
  );
  renderRecipients();
  return update.rejected.length === 0;
}

function syncShareForm(): void {
  const form = shareForm();
  const restricted = restrictedToEmails();
  $("share-recipients-field").hidden = !restricted;

  const recipientCount = restricted ? shareRecipients.length : 0;
  const allowOnce = singleViewAllowed(recipientCount);
  const once = form.querySelector<HTMLInputElement>('[name="maxViews"][value="1"]')!;
  once.disabled = !allowOnce;
  if (!allowOnce) {
    form.querySelector<HTMLInputElement>('[name="maxViews"][value="unlimited"]')!.checked = true;
  }
  $("share-views-hint").hidden = allowOnce;

  const passphrase = String(new FormData(form).get("passphrase") ?? "").trim();
  const protections = [
    ...(restricted && recipientCount > 0
      ? [t("share.protection_emails", { count: recipientCount })]
      : []),
    ...(passphrase ? [t("share.protection_passphrase")] : []),
  ];
  $("share-protection-state").textContent = protections.join(" · ");

  $("share-summary").textContent = [
    t("share.summary_expiry", { duration: optionLabel(checkedOption("ttl")) }),
    t(once.checked ? "share.result_once" : "share.result_unlimited"),
  ].join(" · ");
}

async function openShare(item: VaultItem): Promise<void> {
  clearTimers();
  sharing = item;
  shareRecipients = [];
  setError("share-error", null);
  const form = shareForm();
  form.reset();
  $<HTMLDetailsElement>("share-protection").open = false;
  $("share-result").hidden = true;
  form.hidden = false;
  renderShareSubject(item);
  renderShareFields(item);
  $("share-totp-hint").hidden = !item.totp;

  const { apiUrl } = await getLocal();
  const config = await api.serverConfig(apiUrl ?? "");
  $("share-access-group").hidden = !config.emailVerification;
  setRecipientsHint(null);
  renderRecipients();
  show("share");
}

shareForm().addEventListener("change", syncShareForm);
shareForm().addEventListener("input", (event) => {
  if ((event.target as HTMLElement).id !== "share-recipient-entry") syncShareForm();
});

$("share-recipients").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) $("share-recipient-entry").focus();
});

const recipientEntry = $<HTMLInputElement>("share-recipient-entry");
recipientEntry.addEventListener("keydown", (event) => {
  if (["Enter", ",", ";", " "].includes(event.key)) {
    event.preventDefault();
    commitRecipientEntry();
  } else if (
    event.key === "Backspace" &&
    recipientEntry.value === "" &&
    shareRecipients.length > 0
  ) {
    shareRecipients = shareRecipients.slice(0, -1);
    renderRecipients();
  }
});
recipientEntry.addEventListener("blur", () => commitRecipientEntry());
recipientEntry.addEventListener("paste", () => setTimeout(commitRecipientEntry));

$("share-back").addEventListener("click", () => {
  renderList();
  show("list");
});

$<HTMLFormElement>("form-share").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("share-error", null);
  if (!sharing) return;

  const restricted = restrictedToEmails();
  if (restricted && !commitRecipientEntry()) return;
  if (restricted && shareRecipients.length === 0) {
    setRecipientsHint(t("share.recipients_required"));
    $("share-recipient-entry").focus();
    return;
  }

  const data = new FormData(event.target as HTMLFormElement);
  const passphrase = String(data.get("passphrase") ?? "").trim() || undefined;
  const maxViews = data.get("maxViews") === "1" ? 1 : null;
  const ttlSeconds = Number(data.get("ttl"));
  const recipients = restricted ? [...shareRecipients] : [];

  try {
    const { sealed, fragment } = await createShare(
      {
        title: sharing.title,
        url: sharing.url,
        username: sharing.username,
        password: sharing.password,
        totp: sharing.totp,
      },
      passphrase,
    );

    const created = await api.createShareLink(sealed, { ttlSeconds, maxViews, recipients });
    const { apiUrl } = await getLocal();
    const url = buildShareUrl(apiUrl!, created.id, fragment);
    if (vaultKey) {
      await rememberSharedLink(vaultKey, {
        id: created.id,
        url,
        itemId: sharing.id,
        title: sharing.title,
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: created.expiresAt,
        maxViews,
        recipients,
        hasPassphrase: Boolean(passphrase),
        revokeToken: created.revokeToken,
      });
    }

    $<HTMLInputElement>("share-url").value = url;
    $("share-note").textContent = [
      sharing.title,
      t("links.expires", { expiry: formatExpiry(created.expiresAt) }),
      t(maxViews === 1 ? "share.result_once" : "share.result_unlimited"),
      ...(recipients.length > 0 ? [t("links.restricted", { count: recipients.length })] : []),
    ].join(" · ");
    $("share-passphrase-note").hidden = !passphrase;

    $("form-share").hidden = true;
    $("share-result").hidden = false;
  } catch (error) {
    showError("share-error", error);
  }
});

$("share-copy").addEventListener("click", async () => {
  // The link carries the decryption key, so it gets the same clipboard timeout.
  await copy($<HTMLInputElement>("share-url").value, t("share.link").toLowerCase());
});

async function openSettings(): Promise<void> {
  clearTimers();
  setError("settings-error", null);
  $("form-change-password").hidden = true;

  const local = await getLocal();

  const minutes = local.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES;
  const choices = AUTO_LOCK_CHOICES.includes(minutes)
    ? AUTO_LOCK_CHOICES
    : [...AUTO_LOCK_CHOICES, minutes].sort((a, b) => (a || Infinity) - (b || Infinity));
  const lockSelect = $<HTMLSelectElement>("settings-lock");
  lockSelect.replaceChildren(
    ...choices.map((choice) => new Option(lockLabel(choice), String(choice))),
  );
  lockSelect.value = String(minutes);

  const select = $<HTMLSelectElement>("settings-locale");
  select.replaceChildren(
    new Option(t("settings.language_auto"), "auto"),
    ...LOCALES.map((code) => new Option(LOCALE_NAMES[code], code)),
  );
  select.value = local.locale ?? "auto";
  $("settings-autofill").closest("label")!.hidden = !autofillSupported();
  $<HTMLInputElement>("settings-autofill").checked = await isAutofillEnabled();

  $("settings-about").replaceChildren(
    logo(16),
    wordmark(),
    ` · v${chrome.runtime.getManifest().version}`,
  );
  $("settings-email").textContent = local.email ?? "";
  $("settings-email").title = local.email ?? "";
  $("settings-count").textContent = String(items.length);
  $("settings-last-sync").textContent = local.lastSync
    ? formatExpiry(local.lastSync)
    : t("settings.never_synced");

  show("settings");
}

$("settings-back").addEventListener("click", () => {
  renderList();
  show("list");
});

function lockLabel(minutes: number): string {
  if (minutes === LOCK_ON_BROWSER_CLOSE) return t("settings.lock_on_close");
  return minutes % 60 === 0
    ? t("settings.hours", { count: minutes / 60 })
    : t("settings.minutes", { count: minutes });
}

$("settings-lock").addEventListener("change", async (event) => {
  await setLocal({ autoLockMinutes: Number((event.target as HTMLSelectElement).value) });
  await touch();
});

$("settings-locale").addEventListener("change", async (event) => {
  const preference = (event.target as HTMLSelectElement).value as LocalePreference;
  await setLocal({ locale: preference });
  locale = resolveLocale(preference);
  t = createTranslator(locale);
  applyStaticText();
  renderSetupForm();
  if (vaultKey) items = await decryptAll(vaultKey, locale);
  await openSettings();
});

$("settings-autofill").addEventListener("change", async (event) => {
  const checkbox = event.target as HTMLInputElement;
  if (checkbox.checked) {
    checkbox.checked = await turnOnAutofill();
  } else {
    await disableAutofill();
  }
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
    setError("settings-error", t("setup.password_mismatch"));
    return;
  }
  if (!vaultKeyRaw) {
    setError("settings-error", t("settings.need_relock"));
    return;
  }

  const local = await getLocal();

  let currentAuthKey: string;
  try {
    const masterKey = await deriveMasterKey(local.email!, String(data.get("current")), local.kdf!);
    await openSealed(await deriveWrappingKey(masterKey), local.wrappedVaultKey!);
    currentAuthKey = toBase64(await deriveAuthKey(masterKey));
  } catch {
    setError("settings-error", t("settings.wrong_current"));
    return;
  }

  try {
    const record = await rewrapVaultKey(local.email!, next, vaultKeyRaw);
    await api.changePassword(currentAuthKey, record);
    await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
    await lock();
    alert(t("settings.changed"));
    location.reload();
  } catch (error) {
    showError("settings-error", error);
  }
});

$("settings-delete-account").addEventListener("click", () => {
  $("form-delete-account").hidden = !$("form-delete-account").hidden;
});

$<HTMLFormElement>("form-delete-account").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("settings-error", null);
  const local = await getLocal();
  const password = String(new FormData(event.target as HTMLFormElement).get("current"));

  let currentAuthKey: string;
  try {
    const masterKey = await deriveMasterKey(local.email!, password, local.kdf!);
    await openSealed(await deriveWrappingKey(masterKey), local.wrappedVaultKey!);
    currentAuthKey = toBase64(await deriveAuthKey(masterKey));
  } catch {
    setError("settings-error", t("settings.wrong_current"));
    return;
  }
  if (!confirm(t("settings.delete_confirm", { email: local.email ?? "" }))) return;

  try {
    await api.deleteAccount(currentAuthKey);
    await clearAccountData();
    await lock();
    alert(t("settings.deleted"));
    location.reload();
  } catch (error) {
    showError("settings-error", error);
  }
});

function openImport(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL("import/import.html") });
}

$("settings-import").addEventListener("click", openImport);
$("list-import").addEventListener("click", openImport);

$("settings-privacy").addEventListener("click", async () => {
  const { apiUrl } = await getLocal();
  if (apiUrl) await chrome.tabs.create({ url: `${apiUrl}/privacy` });
});

$("settings-logout").addEventListener("click", async () => {
  if (!confirm(t("settings.logout_confirm"))) return;
  await api.logout();
  await clearAccountData();
  await lock();
  location.reload();
});

void boot();

function formatExpiry(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString(locale, {
    day: "numeric",
    month: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sharedLinkRow(link: SharedLink, viewsLeft: number | null, expiresAt: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "link-row";

  const text = document.createElement("div");
  text.className = "item-name";
  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = link.title;
  const sub = document.createElement("div");
  sub.className = "item-sub";
  sub.textContent = [
    t("links.expires", { expiry: formatExpiry(expiresAt) }),
    ...(viewsLeft === null ? [] : [t("links.views_left", { views: viewsLeft })]),
    ...(link.recipients.length > 0
      ? [t("links.restricted", { count: link.recipients.length })]
      : []),
  ].join(" · ");
  sub.title = sub.textContent;
  text.append(title, sub);

  const revoke = iconButton("link-off", t("links.revoke"), async () => {
    if (!vaultKey || !confirm(t("links.revoke_confirm", { title: link.title }))) return;
    setError("links-error", null);
    try {
      await api.revokeShareLink(link.id, link.revokeToken);
      await forgetSharedLink(vaultKey, link.id);
      row.remove();
      $("links-empty").hidden = $("links-list").childElementCount > 0;
      toast(t("links.revoked"));
    } catch (error) {
      showError("links-error", error);
    }
  });
  revoke.classList.add("revoke");

  row.append(
    avatar(link.title),
    text,
    iconButton("copy", t("links.copy"), () => copy(link.url, t("share.link").toLowerCase())),
    revoke,
  );
  return row;
}

async function openLinks(): Promise<void> {
  clearTimers();
  setError("links-error", null);
  $("links-list").replaceChildren();
  $("links-empty").hidden = true;
  show("links");
  if (!vaultKey) return;

  try {
    const links = await loadSharedLinks(vaultKey);
    const statuses = new Map(
      (await api.shareStatuses(links.map(({ id, revokeToken }) => ({ id, revokeToken })))).map(
        (status) => [status.id, status],
      ),
    );
    const active = links.filter((link) => statuses.get(link.id)?.active);
    if (active.length !== links.length) await saveSharedLinks(vaultKey, active);

    $("links-list").replaceChildren(
      ...active.map((link) => {
        const status = statuses.get(link.id);
        return status?.active
          ? sharedLinkRow(link, status.viewsLeft, status.expiresAt)
          : sharedLinkRow(link, 0, link.expiresAt);
      }),
    );
    $("links-empty").hidden = active.length > 0;
  } catch (error) {
    showError("links-error", error);
  }
}

$("share-manage").addEventListener("click", () => void openLinks());
$("settings-links").addEventListener("click", () => void openLinks());
$("links-back").addEventListener("click", () => {
  renderList();
  show("list");
});
