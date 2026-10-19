import { useState } from "preact/hooks";
import {
  isSecretName,
  parseDotenv,
  parseHosts,
  type Environment,
  type SecretKind,
} from "../../../src/core/projects.js";
import type { Secret } from "../../lib/projects.js";
import { useT } from "../../ui/i18n.js";
import { Dialog, Field } from "../components.js";

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
        const hosts = kind === "secret" ? parseHosts(String(data.get("hosts") ?? "")) : [];
        if (!hosts) return setError(t("console.agent_hosts_invalid"));
        onSave({ name, kind, values, hosts });
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
      {kind === "secret" && (
        <Field label={t("console.agent_hosts_optional")} hint={t("console.agent_hosts_hint")}>
          <input
            name="hosts"
            className="mono"
            autoComplete="off"
            spellcheck={false}
            placeholder="api.stripe.com"
            onInput={() => setError(null)}
          />
        </Field>
      )}
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}

export function HostsDialog({
  secret,
  onClose,
  onSave,
}: {
  secret: Secret;
  onClose: () => void;
  onSave: (hosts: string[]) => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={t("console.agent_hosts_title", { name: secret.name })}
      description={t("console.agent_hosts_hint")}
      submitLabel={t("projects.save")}
      onClose={onClose}
      onSubmit={(form) => {
        const hosts = parseHosts(String(new FormData(form).get("hosts") ?? ""));
        if (!hosts) return setError(t("console.agent_hosts_invalid"));
        onSave(hosts);
      }}
    >
      <Field label={t("console.agent_hosts")}>
        <textarea
          name="hosts"
          className="mono"
          rows={3}
          autoFocus
          spellcheck={false}
          placeholder={"api.stripe.com\n*.myshopify.com"}
          defaultValue={(secret.hosts ?? []).join("\n")}
          onInput={() => setError(null)}
        />
      </Field>
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
