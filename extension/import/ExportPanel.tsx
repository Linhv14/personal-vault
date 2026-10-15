import { useEffect, useState } from "preact/hooks";
import { describeError } from "../../src/i18n/index.js";
import { csvExport, encryptExport, EXPORT_PASSPHRASE_MIN } from "../lib/export.js";
import { itemType } from "../lib/item-types.js";
import { decryptEverything, sync, type VaultDef, type VaultItem } from "../lib/vault.js";
import { vaultList, vaultOf } from "../lib/vaults.js";
import { localeSignal, useT } from "../ui/i18n.js";
import { vaultKey } from "./session.js";

type Format = "encrypted" | "csv";

type State =
  | { kind: "loading" }
  | { kind: "locked" }
  | { kind: "ready"; items: VaultItem[]; vaults: VaultDef[] }
  | { kind: "done"; file: string; count: number; format: Format };

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function fileName(format: Format): string {
  const date = new Date().toISOString().slice(0, 10);
  return format === "encrypted" ? `1pw-export-${date}.json` : `1pw-logins-${date}.csv`;
}

export function ExportPanel() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [vault, setVault] = useState("all");
  const [format, setFormat] = useState<Format>("encrypted");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void (async () => {
      const key = await vaultKey();
      if (!key) {
        setState({ kind: "locked" });
        return;
      }
      await sync().catch(() => null);
      const { items, system } = await decryptEverything(key, localeSignal.value);
      setState({ kind: "ready", items, vaults: vaultList(system, t("vault.personal")) });
    })();
  }, []);

  if (state.kind === "loading") return null;
  if (state.kind === "locked") {
    return (
      <section className="card">
        <p>{t("import.locked")}</p>
      </section>
    );
  }
  if (state.kind === "done") {
    return (
      <section className="card">
        <h2>{t("export.done", { count: state.count })}</h2>
        <p className="hint">{state.file}</p>
        <p className="warning">
          {t(state.format === "csv" ? "export.done_csv" : "export.done_encrypted")}
        </p>
      </section>
    );
  }

  const chosen = state.items.filter((item) => vault === "all" || vaultOf(item) === vault);
  const count =
    format === "csv" ? chosen.filter((item) => itemType(item) === "login").length : chosen.length;

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const passphrase = String(data.get("passphrase") ?? "");
    if (format === "encrypted") {
      if (passphrase.length < EXPORT_PASSPHRASE_MIN) {
        setError(t("export.passphrase_short", { count: EXPORT_PASSPHRASE_MIN }));
        return;
      }
      if (passphrase !== String(data.get("confirm") ?? "")) {
        setError(t("setup.password_mismatch"));
        return;
      }
    }
    setWorking(true);
    try {
      const name = fileName(format);
      if (format === "encrypted") {
        download(name, await encryptExport(chosen, passphrase), "application/json");
      } else {
        download(name, csvExport(chosen).csv, "text/csv");
      }
      setState({ kind: "done", file: name, count, format });
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(event) => void submit(event)}>
      {state.vaults.length > 1 && (
        <label className="field">
          <span>{t("export.vault")}</span>
          <select value={vault} onChange={(event) => setVault(event.currentTarget.value)}>
            <option value="all">{t("vault.all")}</option>
            {state.vaults.map((entry) => (
              <option value={entry.id} key={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="formats">
        <legend>{t("export.format")}</legend>
        {(["encrypted", "csv"] as const).map((value) => (
          <label className="format" key={value}>
            <input
              type="radio"
              name="format"
              value={value}
              checked={format === value}
              onChange={() => setFormat(value)}
            />
            <span className="format-text">
              <strong>
                {t(value === "encrypted" ? "export.encrypted" : "export.csv")}
                {value === "encrypted" && <span className="badge">{t("export.recommended")}</span>}
              </strong>
              <small>
                {t(value === "encrypted" ? "export.encrypted_hint" : "export.csv_hint")}
              </small>
            </span>
          </label>
        ))}
      </fieldset>

      {format === "encrypted" ? (
        <div className="stack tight">
          <label className="field">
            <span>{t("export.passphrase")}</span>
            <input
              name="passphrase"
              type="password"
              autoComplete="new-password"
              minLength={EXPORT_PASSPHRASE_MIN}
              required
            />
          </label>
          <label className="field">
            <span>{t("export.confirm")}</span>
            <input name="confirm" type="password" autoComplete="new-password" required />
          </label>
          <p className="hint">{t("export.passphrase_hint")}</p>
        </div>
      ) : (
        <div className="stack tight">
          <p className="warning">{t("export.csv_warning")}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.currentTarget.checked)}
            />
            <span>{t("export.csv_understood")}</span>
          </label>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          className="button primary"
          type="submit"
          disabled={working || count === 0 || (format === "csv" && !understood)}
        >
          {t("export.submit", { count })}
        </button>
      </div>
    </form>
  );
}
