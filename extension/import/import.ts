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
import { getLocal, getUnlocked } from "../lib/storage.js";
import { decryptAll, importItems, importKey, sync } from "../lib/vault.js";

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

const STATES = ["locked", "pick", "review", "progress", "done"] as const;

function show(state: (typeof STATES)[number]): void {
  for (const name of STATES) $(`state-${name}`).hidden = name !== state;
}

const SKIP_KEYS: Record<SkipReason, MessageKey> = {
  duplicate: "import.skipped_duplicate",
  trashed: "import.skipped_trashed",
  alias: "import.skipped_alias",
  card: "import.skipped_card",
  identity: "import.skipped_identity",
  other: "import.skipped_other",
};

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

$<HTMLInputElement>("file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  $("error").hidden = true;
  if (!file) return;

  const key = await vaultKey();
  if (!key) return show("locked");

  try {
    await sync().catch(() => null);
    const entries = await readProtonPassExport(new Uint8Array(await file.arrayBuffer()));
    plan = planImport(entries, await decryptAll(key, locale));
  } catch (error) {
    showError(
      error instanceof ImportError
        ? t(`import.error_${error.code}` as MessageKey)
        : describeError(error, t),
    );
    return;
  }

  $("review-title").textContent = t("import.ready", { count: plan.items.length });
  $("review-skipped").replaceChildren(
    ...Object.entries(plan.skipped).map(([reason, count]) => {
      const item = document.createElement("li");
      item.textContent = t(SKIP_KEYS[reason as SkipReason], { count });
      return item;
    }),
  );
  const confirmButton = $<HTMLButtonElement>("confirm");
  confirmButton.textContent = t("import.confirm", { count: plan.items.length });
  confirmButton.disabled = plan.items.length === 0;
  show("review");
});

$("cancel").addEventListener("click", () => {
  plan = null;
  show("pick");
});

$("confirm").addEventListener("click", async () => {
  const key = await vaultKey();
  if (!key) return show("locked");
  if (!plan) return;
  const total = plan.items.length;
  const progress = $<HTMLProgressElement>("progress");
  const report = (saved: number) => {
    $("progress-title").textContent = t("import.progress", { saved, total });
    progress.value = total ? saved / total : 1;
  };
  report(0);
  show("progress");

  try {
    const saved = await importItems(key, plan.items, report);
    $("done-title").textContent = t("import.done", { count: saved });
    show("done");
  } catch (error) {
    show("pick");
    showError(describeError(error, t));
  }
});

show((await vaultKey()) ? "pick" : "locked");
