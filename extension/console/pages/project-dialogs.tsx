import { useState } from "preact/hooks";
import { isSecretName, parseDotenv, type Environment } from "../../../src/core/projects.js";
import type { Secret } from "../../lib/projects.js";
import { useT } from "../../ui/i18n.js";
import { Dialog, Field } from "../components.js";

export interface SecretDraft {
  name: string;
  values: Record<string, string>;
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
  return (
    <Dialog
      title={t("projects.add_secret")}
      submitLabel={t("projects.save")}
      onClose={onClose}
      onSubmit={(form) => {
        const data = new FormData(form);
        const name = String(data.get("name")).trim();
        if (!isSecretName(name)) return setError(t("projects.invalid_name"));
        if (included.length === 0) return setError(t("console.pick_environment"));
        const taken = included.find((id) => existing[id]?.some((secret) => secret.name === name));
        if (taken) {
          const env = environments.find((entry) => entry.id === taken)?.name ?? "";
          return setError(t("console.name_taken_in", { name, env }));
        }
        const values = Object.fromEntries(
          included.map((id) => [id, String(data.get(`value-${id}`) ?? "")]),
        );
        onSave({ name, values });
      }}
    >
      <Field label={t("console.secret_name")} hint={t("console.secret_name_hint")}>
        <input
          name="name"
          className="mono"
          required
          autoFocus
          autoComplete="off"
          spellcheck={false}
          placeholder="DATABASE_URL"
          onInput={() => setError(null)}
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
              />
            </div>
          );
        })}
      </div>
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
  onImport: (environmentId: string, text: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [target, setTarget] = useState(environmentId);
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
      onSubmit={() => onImport(target, text)}
    >
      <Field label={t("console.environment")}>
        <select value={target} onChange={(event) => setTarget(event.currentTarget.value)}>
          {environments.map((env) => (
            <option value={env.id} key={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("console.dotenv")} hint={t("projects.import_hint")}>
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
      submitLabel={submitLabel}
      danger
      busy={typed.trim() !== phrase}
      onClose={onClose}
      onSubmit={onConfirm}
    >
      <Field label={t("console.type_to_confirm", { phrase })}>
        <input
          value={typed}
          autoFocus
          autoComplete="off"
          onInput={(event) => setTyped(event.currentTarget.value)}
        />
      </Field>
    </Dialog>
  );
}
