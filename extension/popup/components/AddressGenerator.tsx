import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
  ADDRESS_COUNTRIES,
  DEFAULT_EMAIL_DOMAIN,
  emailDomainOf,
  generateAddress,
  type AddressCountry,
  type RandomAddress,
} from "../../../src/core/address-generator.js";
import type { MessageKey } from "../../../src/i18n/index.js";
import type { IconName } from "../../../src/ui/icons.js";
import { flagMarkup } from "../../../src/ui/marks.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import { copy, openEditor } from "../state.js";
import { CopyRow } from "./FieldRow.js";

const COUNTRY_LABEL: Record<AddressCountry, MessageKey> = {
  US: "gen.country_us",
  VN: "gen.country_vn",
};

const ROWS: readonly (readonly [keyof RandomAddress, MessageKey, IconName])[] = [
  ["fullName", "field.full_name", "person"],
  ["address", "field.address", "home"],
  ["ward", "field.ward", "map-pin"],
  ["city", "field.city", "map-pin"],
  ["region", "field.region", "map-pin"],
  ["postalCode", "field.postal_code", "mail"],
  ["country", "field.country", "globe"],
  ["phone", "field.phone", "phone"],
  ["email", "field.email", "mail"],
];

export function Flag({ code }: { code: string }) {
  const markup = flagMarkup(code);
  if (!markup) return <span className="flag">{code}</span>;
  return (
    <svg
      className="flag"
      viewBox="0 0 24 16"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function AddressGenerator({ modes }: { modes: ComponentChildren }) {
  const t = useT();
  const [country, setCountry] = useState<AddressCountry>("US");
  const [withEmail, setWithEmail] = useState(true);
  const [domain, setDomain] = useState("");
  const [round, setRound] = useState(0);

  const generated = useMemo(() => generateAddress({ country, email: true }), [country, round]);
  const address: RandomAddress = {
    ...generated,
    email: withEmail
      ? `${generated.email?.split("@")[0] ?? ""}@${emailDomainOf(domain)}`
      : undefined,
  };

  const save = () => openEditor(null, "identity", { ...address, title: address.fullName });

  return (
    <>
      <div className="gen-address" id="gen-address">
        <div className="group">
          {ROWS.map(([key, label, icon]) => {
            const value = address[key];
            if (!value) return null;
            return (
              <CopyRow
                key={key}
                icon={icon}
                label={t(label)}
                multiline={key === "address"}
                onCopy={() => void copy(value, t(label).toLowerCase())}
              >
                <span className="v">
                  {key === "country" && <Flag code={address.code} />}
                  {value}
                </span>
              </CopyRow>
            );
          })}
        </div>
        <div className="gen-footer">
          <span className="gen-spacer" />
          <IconButton
            icon="refresh"
            label={t("gen.regenerate")}
            onClick={() => setRound(round + 1)}
          />
          <IconButton icon="plus" label={t("gen.save_identity")} onClick={save} />
        </div>
      </div>
      {modes}
      <div className="options">
        <div className="segmented gen-countries" role="radiogroup">
          {ADDRESS_COUNTRIES.map((code) => (
            <button
              type="button"
              key={code}
              role="radio"
              aria-checked={country === code}
              title={t(COUNTRY_LABEL[code])}
              aria-label={t(COUNTRY_LABEL[code])}
              className={country === code ? "tab active" : "tab"}
              onClick={() => setCountry(code)}
            >
              <Flag code={code} />
              {code}
            </button>
          ))}
        </div>
        <label className="check">
          <span>{t("gen.include_email")}</span>
          <input
            type="checkbox"
            checked={withEmail}
            onChange={(event) => setWithEmail((event.currentTarget as HTMLInputElement).checked)}
          />
        </label>
        {withEmail && (
          <label className="gen-domain">
            <span>@</span>
            <input
              type="text"
              autoComplete="off"
              spellcheck={false}
              aria-label={t("gen.email_domain")}
              placeholder={DEFAULT_EMAIL_DOMAIN}
              value={domain}
              onInput={(event) => setDomain((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
        )}
      </div>
    </>
  );
}
