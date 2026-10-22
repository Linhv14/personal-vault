import {
  buildOtpauthUri,
  parseTotpInput,
  TOTP_DEFAULTS,
  type TotpConfig,
} from "../../src/core/totp.js";
import type { MessageKey } from "../../src/i18n/index.js";
import { formText } from "../../src/ui/form-data.js";
import {
  cardDigits,
  cleanCustomFields,
  cleanUrls,
  formatCardNumber,
  normalizeExpiry,
  TYPE_FIELDS,
  type FieldSpec,
  type ItemType,
  type TextFieldKey,
} from "../lib/item-types.js";
import { parseRecoveryCodes } from "../lib/recovery-codes.js";
import { registrableDomain } from "../../src/core/site.js";
import type { VaultItem } from "../lib/vault.js";

export type EditedFields = Partial<
  Pick<VaultItem, TextFieldKey | "totp" | "codes" | "urls" | "urlMatch" | "fields" | "tags">
>;

export class InvalidField extends Error {
  constructor(readonly messageKey: MessageKey) {
    super(messageKey);
  }
}

function totpFieldValue(config: TotpConfig): string {
  const usesDefaults =
    config.algorithm === TOTP_DEFAULTS.algorithm &&
    config.digits === TOTP_DEFAULTS.digits &&
    config.period === TOTP_DEFAULTS.period;
  return usesDefaults ? config.secret : buildOtpauthUri(config);
}

export function initialValue(spec: FieldSpec, item: VaultItem | null, tabUrl?: string): string {
  if (!item) {
    return spec.key === "url" && tabUrl ? (registrableDomain(tabUrl) ?? "") : "";
  }
  if (spec.key === "totp") {
    return item.totp ? totpFieldValue(item.totp) : "";
  }
  if (spec.key === "codes") {
    return (item.codes ?? []).join("\n");
  }
  const raw = item[spec.key] ?? "";
  return spec.kind === "cardNumber" ? formatCardNumber(raw) : raw;
}

export function readEditedFields(
  data: FormData,
  type: ItemType,
  hiddenFlags: boolean[],
): EditedFields {
  const text = (key: string, trim = true): string | undefined => {
    const raw = formText(data, key);
    return (trim ? raw.trim() : raw) || undefined;
  };
  const fields: EditedFields = {};
  for (const spec of TYPE_FIELDS[type]) {
    const { key } = spec;
    if (key === "totp") {
      const raw = text(key);
      fields.totp = raw ? parseTotpInput(raw, text("username")) : undefined;
      continue;
    }
    if (key === "cardCvv") {
      const raw = text(key);
      if (raw && !/^\d{3,4}$/.test(raw)) {
        throw new InvalidField("edit.cvv_invalid");
      }
      fields.cardCvv = raw || undefined;
      continue;
    }
    if (key === "codes") {
      const codes = parseRecoveryCodes(formText(data, key));
      fields.codes = codes.length > 0 ? codes : undefined;
      continue;
    }
    switch (spec.kind) {
      case "cardNumber":
        fields[key] = cardDigits(text(key)) || undefined;
        break;
      case "expiry": {
        const raw = text(key);
        const expiry = raw ? normalizeExpiry(raw) : undefined;
        if (expiry === null) {
          throw new InvalidField("edit.expiry_invalid");
        }
        fields[key] = expiry;
        break;
      }
      case "password":
      case "secret":
      case "multilineSecret":
        fields[key] = text(key, false);
        break;
      default:
        fields[key] = text(key);
    }
  }
  if (type === "login") {
    fields.urls = cleanUrls(data.getAll("urls").map(String));
    fields.urlMatch = data.get("urlMatch") ? "host" : undefined;
  }
  const labels = data.getAll("customLabel").map(String);
  const values = data.getAll("customValue").map(String);
  fields.fields = cleanCustomFields(
    labels.map((label, index) => ({
      label,
      value: values[index] ?? "",
      hidden: hiddenFlags[index] === true,
    })),
  );
  const tags = [
    ...new Set(
      formText(data, "tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  fields.tags = tags.length > 0 ? tags : undefined;
  return fields;
}
