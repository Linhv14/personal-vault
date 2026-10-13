import {
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  open as openSealed,
  rewrapVaultKey,
} from "../../src/core/crypto.js";
import { fromBase64, toBase64, type Bytes } from "../../src/core/bytes.js";
import {
  createTranslator,
  describeError,
  LOCALE_NAMES,
  LOCALES,
  resolveLocale,
  type LocalePreference,
} from "../../src/i18n/index.js";
import { hydrateIcons, iconButton } from "../../src/ui/icons.js";
import * as api from "../lib/api.js";
import {
  autofillSupported,
  disableAutofill,
  enableAutofill,
  isAutofillEnabled,
} from "../lib/autofill-permission.js";
import { scheduleClipboardClear } from "../lib/clipboard.js";
import { $, translatePage } from "../lib/page.js";
import {
  forgetSharedLink,
  loadSharedLinks,
  saveSharedLinks,
  type SharedLink,
} from "../lib/shared-links.js";
import {
  AUTO_LOCK_CHOICES,
  clearAccountData,
  DEFAULT_AUTO_LOCK_MINUTES,
  getLocal,
  getUnlocked,
  lock,
  LOCK_ON_BROWSER_CLOSE,
  setLocal,
  touch,
} from "../lib/storage.js";
import { importKey } from "../lib/vault.js";

const PAGES = ["general", "security", "data", "account"] as const;
type Page = (typeof PAGES)[number];

let t = createTranslator(resolveLocale((await getLocal()).locale));
let vaultKey: CryptoKey | null = null;
let vaultKeyRaw: Bytes | null = null;

function currentPage(): Page {
  const hash = location.hash.slice(1);
  return PAGES.find((page) => page === hash) ?? "general";
}

function showPage(): void {
  const page = currentPage();
  for (const name of PAGES) $(`page-${name}`).hidden = name !== page;
  for (const link of $("nav").querySelectorAll<HTMLAnchorElement>("a")) {
    link.toggleAttribute("aria-current", link.hash === `#${page}`);
  }
  document.title = `${t("settings.title")} · 1PW`;
  if (page === "data") void renderLinks();
}

let toastTimer: number | undefined;
function toast(message: string): void {
  const node = $("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 2200) as unknown as number;
}

function setError(id: string, message: string | null): void {
  const node = $(id);
  node.textContent = message ?? "";
  node.hidden = message === null;
}

function formatTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString(document.documentElement.lang, {
    day: "numeric",
    month: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lockLabel(minutes: number): string {
  if (minutes === LOCK_ON_BROWSER_CLOSE) return t("settings.lock_on_close");
  return minutes % 60 === 0
    ? t("settings.hours", { count: minutes / 60 })
    : t("settings.minutes", { count: minutes });
}

async function refreshUnlocked(): Promise<void> {
  const unlocked = await getUnlocked();
  vaultKeyRaw = unlocked ? fromBase64(unlocked.vaultKeyRaw) : null;
  vaultKey = unlocked ? await importKey(unlocked.vaultKeyRaw) : null;
  for (const node of document.querySelectorAll<HTMLElement>("[data-locked]")) {
    node.hidden = vaultKey !== null;
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-unlocked]")) {
    node.hidden = vaultKey === null;
  }
}

async function render(): Promise<void> {
  const local = await getLocal();
  const locale = resolveLocale(local.locale);
  t = createTranslator(locale);
  document.documentElement.lang = locale;
  translatePage(t);

  const signedIn = Boolean(local.email && local.wrappedVaultKey);
  $("signed-out").hidden = signedIn;

  const select = $<HTMLSelectElement>("settings-locale");
  select.replaceChildren(
    new Option(t("settings.language_auto"), "auto"),
    ...LOCALES.map((code) => new Option(LOCALE_NAMES[code], code)),
  );
  select.value = local.locale ?? "auto";

  const minutes = local.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES;
  const choices = AUTO_LOCK_CHOICES.includes(minutes)
    ? AUTO_LOCK_CHOICES
    : [...AUTO_LOCK_CHOICES, minutes].sort((a, b) => (a || Infinity) - (b || Infinity));
  const lockSelect = $<HTMLSelectElement>("settings-lock");
  lockSelect.replaceChildren(
    ...choices.map((choice) => new Option(lockLabel(choice), String(choice))),
  );
  lockSelect.value = String(minutes);

  $("settings-autofill-row").hidden = !autofillSupported();
  $<HTMLInputElement>("settings-autofill").checked = await isAutofillEnabled();

  $("account-email").textContent = local.email ?? "";
  $("account-server").textContent = local.apiUrl ? new URL(local.apiUrl).host : "";
  $("account-count").textContent = String(
    (local.items ?? []).filter((item) => item.deletedAt === null && item.ciphertext).length,
  );
  $("account-sync").textContent = local.lastSync
    ? formatTime(local.lastSync)
    : t("settings.never_synced");
  $("about-version").textContent = `1PW v${chrome.runtime.getManifest().version}`;
  const privacy = $<HTMLAnchorElement>("privacy-link");
  privacy.hidden = !local.apiUrl;
  if (local.apiUrl) privacy.href = `${local.apiUrl.replace(/\/$/, "")}/privacy`;
  for (const id of ["form-delete-account", "settings-logout"]) $(id).hidden = !signedIn;

  await refreshUnlocked();
  showPage();
}

function linkRow(link: SharedLink, viewsLeft: number | null, expiresAt: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "link-row";
  const text = document.createElement("div");
  text.className = "link-text";
  const title = document.createElement("div");
  title.className = "link-title";
  title.textContent = link.title;
  const sub = document.createElement("div");
  sub.className = "row-hint";
  sub.textContent = [
    t("links.expires", { expiry: formatTime(expiresAt) }),
    ...(viewsLeft === null ? [] : [t("links.views_left", { views: viewsLeft })]),
    ...(link.recipients.length > 0
      ? [t("links.restricted", { count: link.recipients.length })]
      : []),
  ].join(" · ");
  text.append(title, sub);

  const copyButton = iconButton("copy", t("links.copy"), async () => {
    await navigator.clipboard.writeText(link.url);
    toast(t("common.copied", { what: t("share.link").toLowerCase() }));
    await scheduleClipboardClear();
  });
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
      setError("links-error", describeError(error, t));
    }
  });
  revoke.classList.add("danger-icon");
  row.append(text, copyButton, revoke);
  return row;
}

async function renderLinks(): Promise<void> {
  setError("links-error", null);
  if (!vaultKey) return;
  const key = vaultKey;
  try {
    const links = await loadSharedLinks(key);
    const statuses = new Map(
      (await api.shareStatuses(links.map(({ id, revokeToken }) => ({ id, revokeToken })))).map(
        (status) => [status.id, status],
      ),
    );
    const active = links.filter((link) => statuses.get(link.id)?.active);
    if (active.length !== links.length) await saveSharedLinks(key, active);
    $("links-list").replaceChildren(
      ...active.map((link) => {
        const status = statuses.get(link.id);
        return status?.active
          ? linkRow(link, status.viewsLeft, status.expiresAt)
          : linkRow(link, 0, link.expiresAt);
      }),
    );
    $("links-empty").hidden = active.length > 0;
  } catch (error) {
    setError("links-error", describeError(error, t));
  }
}

async function currentAuthKey(password: string): Promise<string | null> {
  const local = await getLocal();
  if (!local.email || !local.kdf || !local.wrappedVaultKey) return null;
  try {
    const masterKey = await deriveMasterKey(local.email, password, local.kdf);
    await openSealed(await deriveWrappingKey(masterKey), local.wrappedVaultKey);
    return toBase64(await deriveAuthKey(masterKey));
  } catch {
    return null;
  }
}

$<HTMLSelectElement>("settings-locale").addEventListener("change", async (event) => {
  await setLocal({ locale: (event.target as HTMLSelectElement).value as LocalePreference });
  await render();
});

$<HTMLSelectElement>("settings-lock").addEventListener("change", async (event) => {
  await setLocal({ autoLockMinutes: Number((event.target as HTMLSelectElement).value) });
  if (vaultKey) await touch();
  toast(t("settings.saved"));
});

$<HTMLInputElement>("settings-autofill").addEventListener("change", async (event) => {
  const checkbox = event.target as HTMLInputElement;
  if (checkbox.checked) {
    checkbox.checked = await enableAutofill();
    if (checkbox.checked) toast(t("settings.autofill_enabled"));
  } else {
    await disableAutofill();
  }
});

$<HTMLFormElement>("form-change-password").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("change-error", null);
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  const next = String(data.get("next"));
  if (next !== String(data.get("confirm"))) {
    setError("change-error", t("setup.password_mismatch"));
    return;
  }
  if (!vaultKeyRaw) {
    setError("change-error", t("settings.locked_hint"));
    return;
  }
  const authKey = await currentAuthKey(String(data.get("current")));
  const { email } = await getLocal();
  if (!authKey || !email) {
    setError("change-error", t("settings.wrong_current"));
    return;
  }
  try {
    const record = await rewrapVaultKey(email, next, vaultKeyRaw);
    await api.changePassword(authKey, record);
    await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
    await lock();
    form.reset();
    toast(t("settings.changed"));
    await render();
  } catch (error) {
    setError("change-error", describeError(error, t));
  }
});

$("settings-logout").addEventListener("click", async () => {
  if (!confirm(t("settings.logout_confirm"))) return;
  await api.logout().catch(() => null);
  await clearAccountData();
  await lock();
  await render();
});

$<HTMLFormElement>("form-delete-account").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("delete-error", null);
  const form = event.target as HTMLFormElement;
  const authKey = await currentAuthKey(String(new FormData(form).get("current")));
  const { email } = await getLocal();
  if (!authKey) {
    setError("delete-error", t("settings.wrong_current"));
    return;
  }
  if (!confirm(t("settings.delete_confirm", { email: email ?? "" }))) return;
  try {
    await api.deleteAccount(authKey);
    await clearAccountData();
    await lock();
    form.reset();
    toast(t("settings.deleted"));
    await render();
  } catch (error) {
    setError("delete-error", describeError(error, t));
  }
});

addEventListener("hashchange", showPage);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== "session") return;
  void refreshUnlocked().then(async () => {
    if (currentPage() === "data") await renderLinks();
  });
});

hydrateIcons(document);
await render();
