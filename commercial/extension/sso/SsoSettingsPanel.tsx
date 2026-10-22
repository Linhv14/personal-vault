import { useEffect, useState } from "preact/hooks";
import { normalizeDomain } from "#core/org-model.js";
import { describeError } from "#i18n/index.js";
import { formText } from "#ui/form-data.js";
import { ActionButton, Badge, Field, PanelHead, When } from "#ext/console/components.js";
import { useConsole } from "#ext/console/data.js";
import { formatDateTime } from "#ext/ui/format.js";
import { localeSignal, useT } from "#ext/ui/i18n.js";
import { normalizeIdentifier, type DecryptionOption } from "#commercial/core/sso-model.js";
import {
  addSsoDomain,
  removeSsoDomain,
  saveSsoPolicies,
  saveSsoProvider,
  setSsoIdentifier,
  ssoOverview,
  verifySsoDomain,
  type SsoOverview,
} from "./api.js";

const STACK = { display: "grid", gap: "12px" } as const;
const SECTIONS = { display: "grid", gap: "24px" } as const;

function LicenseLine({ overview }: { overview: SsoOverview }) {
  const t = useT();
  const { license } = overview;
  const date = (at: number) => formatDateTime(at, localeSignal.value);
  if (overview.plan === "enterprise") {
    return <Badge tone="ok">{t("sso_admin.plan_enterprise")}</Badge>;
  }
  if (license.status === "valid") {
    return (
      <Badge tone="ok">
        {t("sso_admin.license_valid", {
          licensee: license.licensee,
          seats: license.seats,
          date: date(license.expiresAt),
        })}
      </Badge>
    );
  }
  if (license.status === "expired") {
    return (
      <Badge tone="danger">
        {t("sso_admin.license_expired", {
          licensee: license.licensee,
          date: date(license.expiresAt),
        })}
      </Badge>
    );
  }
  return (
    <Badge tone="warn">
      {t(license.status === "invalid" ? "sso_admin.license_invalid" : "sso_admin.license_missing")}
    </Badge>
  );
}

export function SsoSettingsPanel() {
  const t = useT();
  const { detail, run } = useConsole();
  const orgId = detail.org.id;
  const [overview, setOverview] = useState<SsoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identifierInvalid, setIdentifierInvalid] = useState(false);
  const [domainInvalid, setDomainInvalid] = useState(false);

  useEffect(() => {
    setOverview(null);
    ssoOverview(orgId).then(setOverview, (failure: unknown) => setError(describeError(failure, t)));
  }, [orgId]);

  const apply = (work: () => Promise<SsoOverview>, done: Parameters<typeof run>[1]) =>
    run(async () => setOverview(await work()), done);

  if (error) {
    return (
      <section className="panel" id="sso-settings">
        <PanelHead title={t("sso_admin.title")} />
        <p className="alert">{error}</p>
      </section>
    );
  }
  if (!overview) {
    return null;
  }

  const locked = !overview.available;
  const provider = overview.provider;

  return (
    <section className="panel" id="sso-settings">
      <PanelHead title={t("sso_admin.title")} text={t("sso_admin.text")} />
      <div style={SECTIONS}>
        <div>
          <LicenseLine overview={overview} />
        </div>

        <form
          style={STACK}
          onSubmit={(event) => {
            event.preventDefault();
            const identifier = normalizeIdentifier(
              formText(new FormData(event.currentTarget), "identifier"),
            );
            setIdentifierInvalid(!identifier);
            if (identifier) {
              void apply(() => setSsoIdentifier(orgId, identifier), "sso_admin.identifier_saved");
            }
          }}
        >
          <h3>{t("sso_admin.identifier")}</h3>
          <Field label={t("sso_admin.identifier")} hint={t("sso_admin.identifier_hint")}>
            <input
              name="identifier"
              defaultValue={overview.identifier ?? ""}
              placeholder="acme"
              maxLength={32}
              spellcheck={false}
              autoComplete="off"
              disabled={locked}
              aria-invalid={identifierInvalid || undefined}
            />
          </Field>
          {identifierInvalid && <p className="form-error">{t("error.sso.invalid_identifier")}</p>}
          <div>
            <button type="submit" className="btn primary" disabled={locked}>
              {t("projects.save")}
            </button>
          </div>
        </form>

        <div style={STACK}>
          <h3>{t("sso_admin.domains")}</h3>
          <p className="field-hint">{t("sso_admin.domains_hint")}</p>
          {overview.domains.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("sso_admin.domain")}</th>
                  <th>{t("sso_admin.txt_record")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overview.domains.map((entry) => (
                  <tr key={entry.domain}>
                    <td>
                      <span className="cell-title">
                        {entry.domain}
                        {entry.verified ? (
                          <Badge tone="ok">{t("sso_admin.verified")}</Badge>
                        ) : (
                          <Badge tone="warn">{t("sso_admin.pending")}</Badge>
                        )}
                      </span>
                      {!entry.verified && entry.checkedAt !== null && (
                        <span className="field-hint">
                          {t("sso_admin.last_checked")} <When at={entry.checkedAt} />
                        </span>
                      )}
                    </td>
                    <td>
                      <code className="sso-record">{entry.record}</code>
                    </td>
                    <td className="row-actions">
                      {!entry.verified && (
                        <ActionButton
                          disabled={locked}
                          onClick={() =>
                            apply(
                              () => verifySsoDomain(orgId, entry.domain),
                              "sso_admin.domain_verified",
                            )
                          }
                        >
                          {t("sso_admin.verify")}
                        </ActionButton>
                      )}
                      <ActionButton
                        className="btn danger"
                        onClick={() =>
                          apply(
                            () => removeSsoDomain(orgId, entry.domain),
                            "sso_admin.domain_removed",
                          )
                        }
                      >
                        {t("orgs.remove")}
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form
            className="domain-add"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const domain = normalizeDomain(formText(new FormData(form), "domain"));
              setDomainInvalid(!domain);
              if (domain) {
                void apply(() => addSsoDomain(orgId, domain), "sso_admin.domain_added").then(
                  (added) => added && form.reset(),
                );
              }
            }}
          >
            <input
              name="domain"
              placeholder="acme.com"
              aria-label={t("sso_admin.domain")}
              aria-invalid={domainInvalid || undefined}
              spellcheck={false}
              autoComplete="off"
              disabled={locked}
            />
            <button type="submit" className="btn" disabled={locked}>
              {t("console.domains_add")}
            </button>
          </form>
          {domainInvalid && <p className="form-error">{t("error.sso.invalid_domain")}</p>}
        </div>

        <form
          style={STACK}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void apply(
              () =>
                saveSsoProvider(orgId, {
                  issuer: formText(data, "issuer").trim(),
                  clientId: formText(data, "clientId").trim(),
                  clientSecret: formText(data, "clientSecret"),
                  enabled: data.get("enabled") === "on",
                  decryption: formText(data, "decryption") as DecryptionOption,
                }),
              "sso_admin.provider_saved",
            );
          }}
        >
          <h3>{t("sso_admin.provider")}</h3>
          <p className="field-hint">{t("sso_admin.provider_hint")}</p>
          <Field label={t("sso_admin.redirect_uri")}>
            <input
              readOnly
              value={overview.redirectUri}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>
          <Field label={t("sso_admin.issuer")}>
            <input
              name="issuer"
              type="url"
              required
              placeholder="https://accounts.google.com"
              defaultValue={provider?.issuer ?? ""}
              disabled={locked}
            />
          </Field>
          <Field label={t("sso_admin.client_id")}>
            <input
              name="clientId"
              required
              autoComplete="off"
              defaultValue={provider?.clientId ?? ""}
              disabled={locked}
            />
          </Field>
          <Field
            label={t("sso_admin.client_secret")}
            hint={provider?.hasSecret ? t("sso_admin.client_secret_kept") : undefined}
          >
            <input
              name="clientSecret"
              type="password"
              autoComplete="off"
              required={!provider?.hasSecret}
              disabled={locked}
            />
          </Field>
          <Field label={t("sso_admin.decryption")} hint={t("sso_admin.decryption_hint")}>
            <select
              name="decryption"
              defaultValue={provider?.decryption ?? "master_password"}
              disabled={locked}
            >
              {overview.decryptionOptions.map((option) => (
                <option key={option} value={option}>
                  {t("sso_admin.decryption_master_password")}
                </option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={provider?.enabled ?? false}
              disabled={locked}
            />
            <span>{t("sso_admin.enabled")}</span>
          </label>
          <div>
            <button type="submit" className="btn primary" disabled={locked}>
              {t("projects.save")}
            </button>
          </div>
        </form>

        <form
          style={STACK}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void apply(
              () =>
                saveSsoPolicies(orgId, {
                  requireSso: data.get("requireSso") === "on",
                  singleOrg: data.get("singleOrg") === "on",
                }),
              "sso_admin.policies_saved",
            );
          }}
        >
          <h3>{t("sso_admin.policies")}</h3>
          <label className="check">
            <input
              type="checkbox"
              name="requireSso"
              defaultChecked={overview.policies.requireSso}
              disabled={locked || !provider?.enabled}
            />
            <span>
              <strong>{t("sso_admin.require_sso")}</strong>
              <small className="field-hint">{t("sso_admin.require_sso_hint")}</small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="singleOrg"
              defaultChecked={overview.policies.singleOrg}
              disabled={locked}
            />
            <span>
              <strong>{t("sso_admin.single_org")}</strong>
              <small className="field-hint">{t("sso_admin.single_org_hint")}</small>
            </span>
          </label>
          <div>
            <button type="submit" className="btn primary" disabled={locked}>
              {t("projects.save")}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
