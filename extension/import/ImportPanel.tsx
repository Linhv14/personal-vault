import { useEffect, useRef, useState } from "preact/hooks";
import { describeError, type MessageKey, type Translate } from "../../src/i18n/index.js";
import { planImport, type ImportPlan } from "../lib/import/plan.js";
import { readExport } from "../lib/import/read-export.js";
import { ImportError, type ImportFormat, type SkipReason } from "../lib/import/source.js";
import { notePasskeys } from "../lib/storage.js";
import { decryptAll, importItems, saveItemPatiently, sync } from "../lib/vault.js";
import { ITEM_TYPES, itemType, TYPE_LABEL } from "../lib/item-types.js";
import { Icon } from "../ui/components/Icon.js";
import { localeSignal, useT } from "../ui/i18n.js";
import { vaultKey } from "./session.js";

type Step =
  | { kind: "loading" }
  | { kind: "locked" }
  | { kind: "pick"; error?: string }
  | { kind: "passphrase"; error?: string }
  | { kind: "review"; plan: ImportPlan }
  | { kind: "progress"; saved: number; total: number; waiting: boolean }
  | { kind: "done"; count: number };

type SelectedFile = { name: string; bytes: Uint8Array };

const SKIP_KEYS: Record<SkipReason, MessageKey> = {
  duplicate: "import.skipped_duplicate",
  trashed: "import.skipped_trashed",
  alias: "import.skipped_alias",
  other: "import.skipped_other",
  passkey: "import.skipped_passkey",
};

const SOURCES: [string, MessageKey][] = [
  ["1PW", "import.source_1pw"],
  ["Proton Pass", "import.source_proton"],
  ["Bitwarden", "import.source_bitwarden"],
  ["1Password", "import.source_1password"],
  ["", "import.source_other_hint"],
];

const SOURCE_NAMES: Record<Exclude<ImportFormat, "recovery">, string> = {
  "1pw": "1PW",
  proton: "Proton Pass",
  bitwarden: "Bitwarden",
  "1password": "1Password",
  csv: "CSV",
};

function importErrorText(error: unknown, t: Translate): string {
  return error instanceof ImportError
    ? t(`import.error_${error.code}` as MessageKey)
    : describeError(error, t);
}

function sourceLines(plan: ImportPlan, t: Translate): string[] {
  if (plan.format === "recovery") {
    return plan.items.map((item) =>
      t("import.recovery_file", {
        title: item.title,
        codes: t("item.codes_count", { count: item.codes?.length ?? 0 }),
      }),
    );
  }
  const byType = ITEM_TYPES.map((type) => ({
    type,
    count: plan.items.filter((item) => itemType(item) === type).length,
  })).filter(({ count }) => count > 0);
  return [
    t("import.from", { source: SOURCE_NAMES[plan.format] }),
    ...(byType.length > 1
      ? byType.map(({ type, count }) => t("import.of_type", { type: t(TYPE_LABEL[type]), count }))
      : []),
  ];
}

function addedLines(plan: ImportPlan, t: Translate): string[] {
  const newPasskeys = plan.items.filter((item) => item.passkey).length;
  return [
    ...sourceLines(plan, t),
    ...(newPasskeys > 0 ? [t("import.passkeys_new", { count: newPasskeys })] : []),
    ...(plan.passkeysForExisting.length > 0
      ? [t("import.passkeys_existing", { count: plan.passkeysForExisting.length })]
      : []),
  ];
}

export function ImportPanel() {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const selected = useRef<SelectedFile | null>(null);
  const passphrase = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void vaultKey().then((key) => setStep(key ? { kind: "pick" } : { kind: "locked" }));
  }, []);

  useEffect(() => {
    if (step.kind !== "passphrase") return;
    if (step.error) passphrase.current?.select();
    else passphrase.current?.focus();
  }, [step]);

  const review = async (file: SelectedFile, secret?: string) => {
    const key = await vaultKey();
    if (!key) {
      setStep({ kind: "locked" });
      return;
    }
    try {
      await sync().catch(() => null);
      const source = await readExport({
        ...file,
        passphrase: secret,
        recoveryTitle: t("type.recovery"),
      });
      setStep({
        kind: "review",
        plan: planImport(source, await decryptAll(key, localeSignal.value)),
      });
    } catch (error) {
      if (error instanceof ImportError && error.code === "needs_passphrase") {
        setStep({ kind: "passphrase" });
      } else if (error instanceof ImportError && error.code === "wrong_passphrase") {
        setStep({ kind: "passphrase", error: importErrorText(error, t) });
      } else {
        setStep({ kind: "pick", error: importErrorText(error, t) });
      }
    }
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    selected.current = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    await review(selected.current);
  };

  const pickFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    await openFile(file);
  };

  const submitPassphrase = async (event: Event) => {
    event.preventDefault();
    if (!selected.current) {
      setStep({ kind: "pick" });
      return;
    }
    setOpening(true);
    try {
      await review(selected.current, passphrase.current?.value ?? "");
    } finally {
      setOpening(false);
    }
  };

  const chooseOther = () => {
    selected.current = null;
    setStep({ kind: "pick" });
  };

  const confirmImport = async (plan: ImportPlan) => {
    const key = await vaultKey();
    if (!key) {
      setStep({ kind: "locked" });
      return;
    }
    const { items: drafts, passkeysForExisting } = plan;
    const total = drafts.length + passkeysForExisting.length;
    const report = (saved: number) => {
      const progress = { kind: "progress" as const, saved, total, waiting: false };
      setStep(progress);
      return progress;
    };
    report(0);
    try {
      let saved = await importItems(key, drafts, report);
      for (const item of passkeysForExisting) {
        const progress = report(saved);
        await saveItemPatiently(key, item, () => setStep({ ...progress, waiting: true }));
        saved += 1;
      }
      report(saved);
      if (drafts.some((item) => item.passkey) || passkeysForExisting.length > 0) {
        await notePasskeys(true);
      }
      setStep({ kind: "done", count: saved });
    } catch (error) {
      setStep({ kind: "pick", error: describeError(error, t) });
    }
  };

  return (
    <>
      {step.kind === "locked" && (
        <section className="card">
          <p>{t("import.locked")}</p>
        </section>
      )}

      {step.kind === "pick" && (
        <section className="card">
          <label
            className={dragging ? "dropzone dragging" : "dropzone"}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void openFile(event.dataTransfer?.files[0]);
            }}
          >
            <Icon name="upload" />
            <strong>{t("import.choose_file")}</strong>
            <small>{t("import.drop")}</small>
            <input
              type="file"
              accept=".zip,.pgp,.json,.1pux,.csv,.txt"
              onChange={(event) => void pickFile(event)}
            />
          </label>
          <p className="hint">{t("import.pick")}</p>
          <ul className="sources">
            {SOURCES.map(([name, hint]) => (
              <li key={hint}>
                <strong>{name || t("import.source_other")}</strong>
                <span>{t(hint)}</span>
              </li>
            ))}
          </ul>
          {step.error && (
            <p className="error" role="alert">
              {step.error}
            </p>
          )}
        </section>
      )}

      {step.kind === "passphrase" && (
        <section className="card">
          <h2>{t("import.passphrase_title")}</h2>
          <p className="hint">{t("import.passphrase_hint")}</p>
          <form className="passphrase" onSubmit={(event) => void submitPassphrase(event)}>
            <input ref={passphrase} type="password" autoComplete="off" required />
            <button className="button primary" type="submit" disabled={opening}>
              {t(opening ? "import.opening" : "import.open")}
            </button>
          </form>
          {step.error && (
            <p className="error" role="alert">
              {step.error}
            </p>
          )}
          <div className="actions">
            <button className="button" onClick={chooseOther}>
              {t("import.choose_other")}
            </button>
          </div>
        </section>
      )}

      {step.kind === "review" && (
        <ReviewStep
          plan={step.plan}
          onConfirm={() => void confirmImport(step.plan)}
          onCancel={chooseOther}
        />
      )}

      {step.kind === "progress" && (
        <section className="card">
          <h2>
            {step.waiting
              ? t("import.waiting")
              : t("import.progress", { saved: step.saved, total: step.total })}
          </h2>
          <progress max={1} value={step.total ? step.saved / step.total : 1} />
        </section>
      )}

      {step.kind === "done" && (
        <section className="card">
          <h2>{t("import.done", { count: step.count })}</h2>
          <p className="warning">{t("import.delete_file")}</p>
        </section>
      )}
    </>
  );
}

function ReviewStep({
  plan,
  onConfirm,
  onCancel,
}: {
  plan: ImportPlan;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const total = plan.items.length + plan.passkeysForExisting.length;
  return (
    <section className="card">
      <h2>{t("import.ready", { count: plan.items.length })}</h2>
      <ul className="summary added">
        {addedLines(plan, t).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <ul className="summary">
        {Object.entries(plan.skipped).map(([reason, count]) => (
          <li key={reason}>{t(SKIP_KEYS[reason as SkipReason], { count })}</li>
        ))}
      </ul>
      <div className="actions">
        <button className="button primary" disabled={total === 0} onClick={onConfirm}>
          {t("import.confirm", { count: total })}
        </button>
        <button className="button" onClick={onCancel}>
          {t("import.choose_other")}
        </button>
      </div>
    </section>
  );
}
