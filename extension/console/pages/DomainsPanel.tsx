import { useState } from "preact/hooks";
import {
  isDomainAllowed,
  normalizeDomain,
  MAX_ALLOWED_DOMAINS,
} from "../../../src/core/org-model.js";
import { setAllowedDomains } from "../../lib/orgs.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { ActionButton, PanelHead } from "../components.js";
import { useConsole } from "../data.js";

export function DomainsPanel() {
  const t = useT();
  const { detail, run } = useConsole();
  const { org, members } = detail;
  const saved = org.allowedDomains;
  const editable = org.role === "owner";
  const [domains, setDomains] = useState<string[]>(saved);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const dirty = domains.join() !== saved.join();
  const outside = saved.length
    ? members.filter((member) => !isDomainAllowed(member.email, saved)).length
    : 0;

  const add = () => {
    const entries = draft.split(/[\s,;]+/).filter(Boolean);
    const parsed = entries.map(normalizeDomain);
    if (parsed.some((entry) => entry === null)) {
      setInvalid(true);
      return;
    }
    const next = [...new Set([...domains, ...(parsed as string[])])];
    if (next.length > MAX_ALLOWED_DOMAINS) {
      setInvalid(true);
      return;
    }
    setDomains(next);
    setDraft("");
  };

  return (
    <section className="panel">
      <PanelHead title={t("console.domains_title")} text={t("console.domains_text")} />
      <div className="domain-editor">
        {domains.length === 0 && !editable && (
          <span className="muted">{t("console.domains_any")}</span>
        )}
        {domains.length > 0 && (
          <div className="domain-chips">
            {domains.map((domain) => (
              <span className="domain-chip" key={domain}>
                @{domain}
                {editable && (
                  <button
                    type="button"
                    aria-label={t("orgs.remove")}
                    onClick={() => setDomains(domains.filter((entry) => entry !== domain))}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {editable && (
          <form
            className="domain-add"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <input
              value={draft}
              placeholder="acme.com"
              aria-label={t("console.domains_title")}
              aria-invalid={invalid || undefined}
              spellcheck={false}
              autoComplete="off"
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setInvalid(false);
              }}
            />
            <button type="submit" className="btn" disabled={!draft.trim()}>
              {t("console.domains_add")}
            </button>
            <ActionButton
              className="btn primary"
              disabled={!dirty}
              onClick={() =>
                run(() => setAllowedDomains(org.id, domains), "console.domains_saved", "org")
              }
            >
              {t("projects.save")}
            </ActionButton>
          </form>
        )}
        {invalid && <p className="form-error">{t("error.orgs.invalid_domains")}</p>}
        {outside > 0 && (
          <p className="field-hint">{t("console.domains_outside", { count: outside })}</p>
        )}
      </div>
    </section>
  );
}
