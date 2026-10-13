import {
  createTranslator,
  describeError,
  resolveLocale,
  type MessageKey,
} from "../../src/i18n/index.js";
import {
  ImportError,
  planImport,
  readProtonPassExport,
  type ImportPlan,
  type SkipReason,
} from "../lib/import/protonpass.js";
import { ApiError } from "../lib/api.js";
import { getLocal, getUnlocked, notePasskeys } from "../lib/storage.js";
import {
  decryptAll,
  importItems,
  importKey,
  saveItem,
  sync,
  type VaultItem,
} from "../lib/vault.js";
import { ITEM_TYPES, itemType, TYPE_LABEL } from "../lib/item-types.js";

const local = await getLocal();
const locale = resolveLocale(local.locale);
const t = createTranslator(locale);
document.documentElement.lang = locale;

for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
  node.textContent = t(node.dataset.i18n as MessageKey);
}
document.title = t("import.title");

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

const STATES = ["locked", "pick", "passphrase", "review", "progress", "done"] as const;

function show(state: (typeof STATES)[number]): void {
  for (const name of STATES) $(`state-${name}`).hidden = name !== state;
}

const SKIP_KEYS: Record<SkipReason, MessageKey> = {
  duplicate: "import.skipped_duplicate",
  trashed: "import.skipped_trashed",
  alias: "import.skipped_alias",
  other: "import.skipped_other",
  passkey: "import.skipped_passkey",
};

const RATE_LIMIT_PAUSE_MS = 20_000;

let plan: ImportPlan | null = null;

async function vaultKey(): Promise<CryptoKey | null> {
  const unlocked = await getUnlocked();
  return unlocked ? importKey(unlocked.vaultKeyRaw) : null;
}

function showError(message: string): void {
  const node = $("error");
  node.textContent = message;
  node.hidden = false;
}

let selected: Uint8Array | null = null;

function importErrorText(error: unknown): string {
  return error instanceof ImportError
    ? t(`import.error_${error.code}` as MessageKey)
    : describeError(error, t);
}

async function review(bytes: Uint8Array, passphrase?: string): Promise<void> {
  const key = await vaultKey();
  if (!key) return show("locked");

  try {
    await sync().catch(() => null);
    const entries = await readProtonPassExport(bytes, passphrase);
    plan = planImport(entries, await decryptAll(key, locale));
  } catch (error) {
    if (error instanceof ImportError && error.code === "needs_passphrase") {
      $("passphrase-error").hidden = true;
      show("passphrase");
      $("passphrase").focus();
      return;
    }
    if (error instanceof ImportError && error.code === "wrong_passphrase") {
      const node = $("passphrase-error");
      node.textContent = importErrorText(error);
      node.hidden = false;
      $<HTMLInputElement>("passphrase").select();
      return;
    }
    show("pick");
    showError(importErrorText(error));
    return;
  }
  const newPasskeys = plan.items.filter((item) => item.passkey).length;
  const total = plan.items.length + plan.passkeysForExisting.length;
  $("review-title").textContent = t("import.ready", { count: plan.items.length });
  const planned = plan.items;
  const byType = ITEM_TYPES.map((type) => ({
    type,
    count: planned.filter((item) => itemType(item) === type).length,
  })).filter(({ count }) => count > 0);
  $("review-added").replaceChildren(
    ...[
      ...(byType.length > 1
        ? byType.map(({ type, count }) => t("import.of_type", { type: t(TYPE_LABEL[type]), count }))
        : []),
      newPasskeys > 0 && t("import.passkeys_new", { count: newPasskeys }),
      plan.passkeysForExisting.length > 0 &&
        t("import.passkeys_existing", { count: plan.passkeysForExisting.length }),
    ]
      .filter((line): line is string => Boolean(line))
      .map((line) => Object.assign(document.createElement("li"), { textContent: line })),
  );
  $("review-skipped").replaceChildren(
    ...Object.entries(plan.skipped).map(([reason, count]) => {
      const item = document.createElement("li");
      item.textContent = t(SKIP_KEYS[reason as SkipReason], { count });
      return item;
    }),
  );
  const confirmButton = $<HTMLButtonElement>("confirm");
  confirmButton.textContent = t("import.confirm", { count: total });
  confirmButton.disabled = total === 0;
  show("review");
}

$<HTMLInputElement>("file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  $("error").hidden = true;
  if (!file) return;
  selected = new Uint8Array(await file.arrayBuffer());
  $<HTMLInputElement>("passphrase").value = "";
  await review(selected);
});

$<HTMLFormElement>("passphrase-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selected) return show("pick");
  const submit = $<HTMLButtonElement>("passphrase-submit");
  submit.disabled = true;
  submit.textContent = t("import.opening");
  try {
    await review(selected, $<HTMLInputElement>("passphrase").value);
  } finally {
    submit.disabled = false;
    submit.textContent = t("import.open");
  }
});

$("passphrase-cancel").addEventListener("click", () => {
  selected = null;
  show("pick");
});

$("cancel").addEventListener("click", () => {
  plan = null;
  selected = null;
  show("pick");
});

$("confirm").addEventListener("click", async () => {
  const key = await vaultKey();
  if (!key) return show("locked");
  if (!plan) return;
  const { items: drafts, passkeysForExisting } = plan;
  const total = drafts.length + passkeysForExisting.length;
  const progress = $<HTMLProgressElement>("progress");
  const report = (saved: number) => {
    $("progress-title").textContent = t("import.progress", { saved, total });
    progress.value = total ? saved / total : 1;
  };
  report(0);
  show("progress");

  try {
    let saved = await importItems(key, drafts, report);
    for (const item of passkeysForExisting) {
      await saveRespectingRateLimit(key, item);
      report(++saved);
    }
    if (drafts.some((item) => item.passkey) || passkeysForExisting.length > 0) {
      await notePasskeys(true);
    }
    $("done-title").textContent = t("import.done", { count: saved });
    show("done");
  } catch (error) {
    show("pick");
    showError(describeError(error, t));
  }
});

async function saveRespectingRateLimit(key: CryptoKey, item: VaultItem): Promise<void> {
  for (;;) {
    try {
      await saveItem(key, item);
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 429) throw error;
      $("progress-title").textContent = t("import.waiting");
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_PAUSE_MS));
    }
  }
}

show((await vaultKey()) ? "pick" : "locked");
