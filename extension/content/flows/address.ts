import { flagMark } from "#ui/marks.js";
import type {
  AddressData,
  AutofillRequest,
  IdentitySuggestion,
} from "#ext/lib/autofill-protocol.js";
import { isLoginUsername, scopeOf } from "../detect.js";
import {
  classifyField,
  detectFields,
  type DetectedField,
  type FormFieldKind,
} from "../forms/classify.js";
import { fillAddress } from "../forms/fill.js";
import { addressValue, countryHint } from "../forms/values.js";
import { send } from "../send.js";
import { state, t } from "../state.js";
import { setRandomValue, setValue } from "../track.js";
import { badge, closeMenu, lockedRow, menuHeading, menuRow, note, showMenu } from "../ui/menu.js";
import { menu } from "../ui/root.js";
import { fillFrom } from "../ui/trigger.js";
import { aliasRows } from "./aliases.js";

async function fillAddressFrom(request: AutofillRequest, input: HTMLInputElement): Promise<void> {
  const response = await send(request);
  closeMenu();
  if (!response.ok || !("identity" in response)) {
    return;
  }
  const data: AddressData = response.identity;
  const random = request.type === "autofill:random-address";
  fillFrom(input, () =>
    fillAddress(detectFields(scopeOf(input)), data, random ? setRandomValue : setValue),
  );
}

const IDENTITY_FIELD: Partial<Record<FormFieldKind, keyof AddressData>> = {
  name: "fullName",
  "given-name": "fullName",
  "family-name": "fullName",
  email: "email",
  tel: "phone",
  organization: "company",
  "street-address": "address",
  "address-line1": "address",
  "address-line2": "address",
  "address-level3": "ward",
  "address-level2": "city",
  "address-level1": "region",
  "postal-code": "postalCode",
  country: "country",
  "country-name": "country",
};

function ownField(input: HTMLInputElement): DetectedField | null {
  const detected = detectFields(scopeOf(input)).find((field) => field.element === input);
  if (detected) {
    return detected;
  }
  const kind = classifyField(input);
  return kind ? { element: input, kind } : null;
}

export function isStandalonePhone(input: HTMLInputElement): boolean {
  return classifyField(input) === "tel" && !isLoginUsername(input);
}

async function fillOneField(id: string, input: HTMLInputElement): Promise<void> {
  const response = await send({ type: "autofill:identity", id });
  closeMenu();
  const field = ownField(input);
  if (!response.ok || !("identity" in response) || !field) {
    return;
  }
  const value = addressValue(field, response.identity, detectFields(scopeOf(input)));
  if (value) {
    fillFrom(input, () => setValue(input, value));
  }
}

function valueRows(input: HTMLInputElement, identities: IdentitySuggestion[]): HTMLElement[] {
  const seen = new Set<string>();
  return identities.flatMap((identity) => {
    const key = identity.value?.toLowerCase().replace(/[\s().-]/g, "");
    if (!identity.value || !key || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [
      menuRow(
        identity.value,
        [identity.title, identity.vault].filter(Boolean).join(" · ") || undefined,
        identity.country ? flagMark(identity.country) : badge("person"),
        () => void fillOneField(identity.id, input),
      ),
    ];
  });
}

export async function openAddressMenu(
  input: HTMLInputElement,
  onlyIfUseful: boolean,
  profile = false,
  standalone = false,
): Promise<void> {
  const own = ownField(input);
  const field = own ? IDENTITY_FIELD[own.kind] : undefined;
  const [response, aliases] = await Promise.all([
    send({ type: "autofill:identities", ...(field ? { field } : {}) }),
    standalone ? Promise.resolve([]) : aliasRows(input),
  ]);
  if (state.activeInput !== input) {
    return;
  }
  const identities = response.ok && "identities" in response ? response.identities : [];
  const values = valueRows(input, identities);
  const empty = standalone ? values.length === 0 : identities.length === 0 && aliases.length === 0;
  if (onlyIfUseful && (!response.ok || empty)) {
    return;
  }
  menu.replaceChildren(menuHeading());
  if (!response.ok) {
    menu.append(note(t("autofill.unavailable")));
    showMenu();
    return;
  }
  if ("locked" in response && response.locked) {
    menu.append(lockedRow());
  }
  menu.append(...values);
  if (standalone) {
    if (values.length === 0 && !("locked" in response && response.locked)) {
      menu.append(note(t("autofill.no_saved_values")));
    }
    showMenu();
    return;
  }
  if (values.length > 0) {
    menu.append(note(t("autofill.fill_whole_form")));
  }
  for (const identity of identities) {
    menu.append(
      menuRow(
        identity.title,
        [identity.detail, identity.vault].filter(Boolean).join(" · ") || undefined,
        identity.country ? flagMark(identity.country) : badge("person"),
        () => void fillAddressFrom({ type: "autofill:identity", id: identity.id }, input),
      ),
    );
  }
  menu.append(...aliases);
  const country = countryHint(
    detectFields(scopeOf(input)),
    location.hostname,
    document.documentElement.lang,
  );
  for (const code of country === "VN" ? (["VN", "US"] as const) : (["US", "VN"] as const)) {
    menu.append(
      menuRow(
        t(profile ? "autofill.random_profile" : "autofill.random_address"),
        t(code === "VN" ? "autofill.random_in_vn" : "autofill.random_in_us"),
        flagMark(code),
        () => fillAddressFrom({ type: "autofill:random-address", country: code }, input),
      ),
    );
  }
  showMenu();
}
