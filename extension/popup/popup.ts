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
import { APP_NAME } from "../../src/core/brand.js";
import { hydrateIcons, icon, iconButton } from "../../src/ui/icons.js";
import { hydrateBrand, logo, wordmark } from "../../src/ui/logo.js";
import {
  clearPendingSignup,
  DEFAULT_AUTO_LOCK_MINUTES,
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

const SCREENS = ["setup", "unlock", "list", "edit", "generator", "share", "settings"] as const;
type Screen = (typeof SCREENS)[number];

function show(screen: Screen): void {
  for (const name of SCREENS) $(`screen-${name}`).hidden = name !== screen;
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
    serverField.value = local.apiUrl ?? deployedServerUrl();
    const signup = await loadPendingSignup();
    if (signup) {
      serverField.value = signup.apiUrl;
      setupField("email").value = signup.email;
      setupField("registrationToken").value = signup.registrationToken;
      codeSentTo = signup.email;
    }
    showServerSummary(serverField.value);
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
  renderList();
  show("list");
  void backgroundSync();
  void refreshAutofillPromo();
}

async function refreshAutofillPromo(): Promise<void> {
  const { autofillPromoDismissed } = await getLocal();
  $("autofill-promo").hidden =
    !autofillSupported() || Boolean(autofillPromoDismissed) || (await isAutofillEnabled());
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

function showServerSummary(url: string): void {
  let host = "";
  try {
    host = url ? new URL(url).host : "";
  } catch {
    host = "";
  }
  $("setup-server-host").textContent = host;
  $("setup-server-summary").hidden = !host;
  $("setup-server-field").hidden = Boolean(host);
}

$("setup-server-change").addEventListener("click", () => {
  $("setup-server-summary").hidden = true;
  $("setup-server-field").hidden = false;
  $<HTMLFormElement>("form-setup").querySelector<HTMLInputElement>('[name="apiUrl"]')!.focus();
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

  $("setup-server").hidden = codeStep;
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
  await chrome.storage.local.clear();
  await lock();
  location.reload();
});

$("search").addEventListener("input", () => renderList());
$("btn-add").addEventListener("click", () => openEditor(null));
$("btn-generator").addEventListener("click", () => openGenerator());
$("btn-settings").addEventListener("click", () => void openSettings());
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
  $("all-title").textContent = query ? t("list.results", { count: rest.length }) : t("list.all");
  renderInto($("all-list"), rest);

  $("list-empty").hidden = items.length > 0;
}

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
  sub.textContent = item.username || (item.url ? (registrableDomain(item.url) ?? item.url) : "");
  name.append(title, sub);
  head.append(avatar(item.title), name);

  if (item.totp) head.append(totpChip(item.totp));
  if (item.password) {
    head.append(
      iconButton("copy", t("common.copy"), () =>
        copy(item.password!, t("common.password").toLowerCase()),
      ),
    );
  }

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

function fillItemBody(body: HTMLElement, item: VaultItem): void {
  if (item.username) body.append(valueRow(t("common.username"), item.username, false));
  if (item.password) body.append(valueRow(t("common.password"), item.password, true));
  if (item.totp) body.append(totpRow(item.totp));
  if (item.url) body.append(valueRow(t("common.url"), item.url, false));
  if (item.note) body.append(valueRow(t("common.note"), item.note, false));

  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.append(
    actionButton("pencil", t("edit.edit_title"), () => openEditor(item)),
    actionButton("share", t("share.title"), () => openShare(item)),
  );
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

function valueRow(label: string, value: string, secret: boolean): HTMLElement {
  const valueNode = document.createElement("span");
  valueNode.className = secret ? "v mono" : "v";
  const masked = "•".repeat(Math.min(value.length, 12));
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
  chip.title = t("common.totp");
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

function openEditor(item: VaultItem | null): void {
  clearTimers();
  editing = item;
  setError("edit-error", null);
  $("edit-totp-hint").textContent = "";

  const form = $<HTMLFormElement>("form-edit");
  form.reset();
  $("edit-title").textContent = t(item ? "edit.edit_title" : "edit.add_title");
  $("edit-delete").hidden = !item;

  const set = (name: string, value: string) => {
    form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
  };

  set("title", item?.title ?? "");
  // Prefill the current tab's domain for a new item.
  set("url", item?.url ?? (item ? "" : tabUrl ? (registrableDomain(tabUrl) ?? "") : ""));
  set("username", item?.username ?? "");
  set("password", item?.password ?? "");
  set("totp", item?.totp ? totpFieldValue(item.totp) : "");
  set("note", item?.note ?? "");
  form.querySelector<HTMLInputElement>('[name="password"]')!.type = "password";
  $("edit-reveal").replaceChildren(icon("eye"));

  show("edit");
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

$("edit-reveal").addEventListener("click", () => {
  const field =
    $<HTMLFormElement>("form-edit").querySelector<HTMLInputElement>('[name="password"]')!;
  field.type = field.type === "password" ? "text" : "password";
  $("edit-reveal").replaceChildren(icon(field.type === "password" ? "eye" : "eye-off"));
});

$("edit-generate").addEventListener("click", () => {
  const field =
    $<HTMLFormElement>("form-edit").querySelector<HTMLInputElement>('[name="password"]')!;
  const generated = generatePassword({ length: 20 });
  field.value = generated.value;
  field.type = "text";
  toast(formatEntropy(generated));
});

/**
 * Read a 2FA QR code from a screenshot of the open tab.
 *
 * Uses Chrome's built-in `BarcodeDetector` rather than bundling a QR library:
 * that library would sit in the path of the TOTP secret — it sees the secret
 * before you do — so it is a bad place to add a dependency. Where the API is
 * missing, pasting by hand still works and always will.
 */
$("edit-scan").addEventListener("click", async () => {
  const hint = $("edit-totp-hint");

  if (!("BarcodeDetector" in self)) {
    hint.textContent = t("edit.scan_unsupported");
    return;
  }

  hint.textContent = t("edit.scanning");
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

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
      hint.textContent = t(codes.length ? "edit.scan_not_qr" : "edit.scan_none");
      return;
    }

    const form = $<HTMLFormElement>("form-edit");
    form.querySelector<HTMLInputElement>('[name="totp"]')!.value = otpauth.rawValue;
    const config = parseTotpInput(otpauth.rawValue);

    const titleField = form.querySelector<HTMLInputElement>('[name="title"]')!;
    if (config.issuer && !titleField.value) titleField.value = config.issuer;

    hint.textContent = t("edit.scan_ok", {
      issuer: config.issuer ? t("edit.scan_ok_issuer", { issuer: config.issuer }) : "",
      code: await generateTotp(config, nowMs()),
    });
  } catch (error) {
    hint.textContent = t("edit.scan_capture_failed", { reason: describeError(error, t) });
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
      setError("edit-error", t("edit.totp_parse_failed", { reason: describeError(error, t) }));
      return;
    }
  }

  if (!vaultKey) return;

  try {
    const wasEditing = editing !== null;
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

function openShare(item: VaultItem): void {
  clearTimers();
  sharing = item;
  setError("share-error", null);
  $("share-result").hidden = true;
  $("form-share").hidden = false;
  $("share-item").textContent = item.title;

  const totpCheckbox =
    $<HTMLFormElement>("form-share").querySelector<HTMLInputElement>('[name="includeTotp"]')!;
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

    const created = await api.createShareLink(sealed, Number(data.get("ttl")), maxViews);
    const { apiUrl } = await getLocal();

    $<HTMLTextAreaElement>("share-url").value = buildShareUrl(apiUrl!, created.id, fragment);
    $("share-note").textContent = t("share.result_note", {
      views: maxViews,
      expiry: new Date(created.expiresAt * 1000).toLocaleString(locale, {
        dateStyle: "short",
        timeStyle: "short",
      }),
    });
    $("share-passphrase-note").hidden = !passphrase;

    $("form-share").hidden = true;
    $("share-result").hidden = false;
  } catch (error) {
    showError("share-error", error);
  }
});

$("share-copy").addEventListener("click", async () => {
  // The link carries the decryption key, so it gets the same clipboard timeout.
  await copy($<HTMLTextAreaElement>("share-url").value, t("share.link").toLowerCase());
});

async function openSettings(): Promise<void> {
  clearTimers();
  setError("settings-error", null);
  $("form-change-password").hidden = true;

  const local = await getLocal();

  const slider = $<HTMLInputElement>("settings-lock");
  slider.value = String(local.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES);
  $("settings-lock-out").textContent = t("settings.minutes", { count: slider.value });

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
  $("settings-info").textContent = t("settings.info", {
    email: local.email ?? "",
    count: items.length,
    sync: local.lastSync
      ? t("settings.synced_at", {
          time: new Date(local.lastSync * 1000).toLocaleTimeString(locale),
        })
      : t("settings.never_synced"),
  });

  show("settings");
}

$("settings-back").addEventListener("click", () => {
  renderList();
  show("list");
});

$("settings-lock").addEventListener("input", async (event) => {
  const minutes = Number((event.target as HTMLInputElement).value);
  $("settings-lock-out").textContent = t("settings.minutes", { count: minutes });
  await setLocal({ autoLockMinutes: minutes });
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
    await chrome.storage.local.clear();
    await lock();
    alert(t("settings.deleted"));
    location.reload();
  } catch (error) {
    showError("settings-error", error);
  }
});

$("settings-privacy").addEventListener("click", async () => {
  const { apiUrl } = await getLocal();
  if (apiUrl) await chrome.tabs.create({ url: `${apiUrl}/privacy` });
});

$("settings-logout").addEventListener("click", async () => {
  if (!confirm(t("settings.logout_confirm"))) return;
  await api.logout();
  await chrome.storage.local.clear();
  await lock();
  location.reload();
});

void boot();
