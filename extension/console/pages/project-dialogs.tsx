import { useState } from "preact/hooks";
import { formText } from "../../../src/ui/form-data.js";
import {
  isSecretName,
  parseDotenv,
  type Environment,
  type SecretKind,
} from "../../../src/core/projects.js";
import type { Secret } from "../../lib/projects.js";
import { useT } from "../../ui/i18n.js";
import { Dialog, Field } from "../components.js";
import { HostChips } from "./HostChips.js";

export interface SecretDraft {
  name: string;
  kind: SecretKind;
  values: Record<string, string>;
  hosts: string[];
}

export function AddSecretDialog({
  environments,
  selected,
  existing,
  onClose,
  onSave,
}: {
  environments: Environment[];
  selected: string[];
  existing: Record<string, Secret[]>;
  onClose: () => void;
  onSave: (draft: SecretDraft) => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [included, setIncluded] = useState<string[]>(selected);
  const [kind, setKind] = useState<SecretKind>("secret");
  const [hosts, setHosts] = useState<string[]>([]);
  const [typed, setTyped] = useState({ name: "", value: "" });
  const suggest = (form: HTMLFormElement | null) => {
    if (!form) {
      return;
    }
    const data = new FormData(form);
    const value = included.map((id) => formText(data, `value-${id}`)).find(Boolean);
    setTyped({ name: formText(data, "name"), value: value ?? "" });
  };
  return (
    <Dialog
      title={t("projects.add_secret")}
      submitLabel={t("projects.save")}
      onClose={onClose}
      onSubmit={(form) => {
        const data = new FormData(form);
        const name = formText(data, "name").trim();
        if (!isSecretName(name)) {
          return setError(t("projects.invalid_name"));
        }
        if (included.length === 0) {
          return setError(t("console.pick_environment"));
        }
        const taken = included.find((id) => existing[id]?.some((secret) => secret.name === name));
        if (taken) {
          const env = environments.find((entry) => entry.id === taken)?.name ?? "";
          return setError(t("console.name_taken_in", { name, env }));
        }
        const values = Object.fromEntries(
          included.map((id) => [id, formText(data, `value-${id}`)]),
        );
        onSave({ name, kind, values, hosts: kind === "secret" ? hosts : [] });
      }}
    >
      <KindPicker value={kind} onChange={setKind} />
      <Field label={t("console.secret_name")}>
        <input
          name="name"
          className="mono"
          required
          autoFocus
          autoComplete="off"
          spellcheck={false}
          placeholder="DATABASE_URL"
          onInput={(event) => {
            setError(null);
            suggest(event.currentTarget.form);
          }}
        />
      </Field>
      <div className="env-values">
        {environments.map((env) => {
          const on = included.includes(env.id);
          return (
            <div className={on ? "env-value" : "env-value off"} key={env.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setIncluded(on ? included.filter((id) => id !== env.id) : [...included, env.id])
                  }
                />
                {env.name}
              </label>
              <textarea
                name={`value-${env.id}`}
                className="mono"
                rows={1}
                disabled={!on}
                placeholder={t("projects.secret_value")}
                aria-label={`${env.name} ${t("projects.secret_value")}`}
                spellcheck={false}
                onInput={(event) => suggest(event.currentTarget.form)}
              />
            </div>
          );
        })}
      </div>
      {kind === "secret" && (
        <div className="field">
          <span className="field-label" title={t("console.agent_hosts_hint")}>
            {t("console.agent_hosts_optional")}
          </span>
          <HostChips
            hosts={hosts}
            name={typed.name}
            value={typed.value}
            editable
            onChange={setHosts}
          />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}

export function ImportDialog({
  environments,
  environmentId,
  existing,
  onClose,
  onImport,
}: {
  environments: Environment[];
  environmentId: string;
  existing: Record<string, Secret[]>;
  onClose: () => void;
  onImport: (environmentId: string, text: string, kind: SecretKind) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [target, setTarget] = useState(environmentId);
  const [kind, setKind] = useState<SecretKind>("secret");
  const parsed = parseDotenv(text);
  const replaced = parsed.filter((entry) =>
    existing[target]?.some((secret) => secret.name === entry.name),
  ).length;
  return (
    <Dialog
      title={t("projects.import")}
      submitLabel={t("console.import_count", { count: parsed.length })}
      busy={parsed.length === 0}
      onClose={onClose}
      onSubmit={() => onImport(target, text, kind)}
    >
      <KindPicker value={kind} onChange={setKind} />
      <Field label={t("console.environment")}>
        <select value={target} onChange={(event) => setTarget(event.currentTarget.value)}>
          {environments.map((env) => (
            <option value={env.id} key={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("console.dotenv")}>
        <textarea
          className="mono"
          rows={8}
          value={text}
          autoFocus
          spellcheck={false}
          placeholder={"API_URL=https://api.example.com\nAPI_KEY=…"}
          onInput={(event) => setText(event.currentTarget.value)}
        />
      </Field>
      {parsed.length > 0 && (
        <p className="field-hint">
          {t("console.import_preview", { count: parsed.length, replaced })}
        </p>
      )}
    </Dialog>
  );
}

export function TypeToConfirmDialog({
  title,
  text,
  phrase,
  submitLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  text: string;
  phrase: string;
  submitLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  return (
    <Dialog
      title={title}
      description={text}
      highlight={[phrase]}
      submitLabel={submitLabel}
      danger
      busy={typed.trim() !== phrase}
      onClose={onClose}
      onSubmit={onConfirm}
    >
      <label className="confirm-phrase">
        <span>
          {t("console.type_to_confirm_before")} <code>{phrase}</code>
        </span>
        <input
          value={typed}
          autoFocus
          autoComplete="off"
          spellcheck={false}
          className={typed.trim() === phrase ? "matched" : undefined}
          onInput={(event) => setTyped(event.currentTarget.value)}
        />
      </label>
    </Dialog>
  );
}

export function KindPicker({
  value,
  onChange,
}: {
  value: SecretKind;
  onChange: (kind: SecretKind) => void;
}) {
  const t = useT();
  return (
    <div className="segmented" role="radiogroup" aria-label={t("console.kind")}>
      {(["secret", "variable"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          role="radio"
          aria-checked={value === kind}
          aria-selected={value === kind}
          onClick={() => onChange(kind)}
        >
          {t(kind === "secret" ? "console.kind_secret" : "console.kind_variable")}
        </button>
      ))}
    </div>
  );
}
