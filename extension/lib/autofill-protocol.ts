import type { LookalikeMatch } from "#core/lookalike.js";
import { isPlainObject } from "#core/json.js";
import { CARD_BRAND_NAMES, type CardBrand } from "./item-types.js";

export const AUTOFILL_SCRIPT_ID = "personal-vault-autofill";
export const CARD_FRAME_SCRIPT_ID = "personal-vault-card-frame";
export const PASSKEY_PAGE_SCRIPT_ID = "personal-vault-passkey-page";
export const PASSKEY_BRIDGE_SCRIPT_ID = "personal-vault-passkey-bridge";
export const AUTOFILL_ORIGINS = ["https://*/*", "http://*/*"];

export interface Suggestion {
  id: string;
  title: string;
  username?: string;
  vault?: string;
}

export interface CardSuggestion {
  id: string;
  title: string;
  brand: CardBrand;
  last4: string;
  vault?: string;
}

export interface IdentitySuggestion {
  id: string;
  title: string;
  value?: string;
  detail?: string;
  country?: string;
  vault?: string;
}

export interface CardData {
  cardholder?: string;
  number: string;
  expiry?: string;
  cvv?: string;
  brand: CardBrand;
}

export interface AddressData {
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  ward?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface CapturedCard {
  cardholder?: string;
  number?: string;
  expiry?: string;
  cvv?: string;
}

export interface FormPrompt {
  kind: "card" | "address";
  domain: string;
  update: boolean;
  random?: boolean;
  brand?: CardBrand;
  last4?: string;
  expiry?: string;
  hasCvv?: boolean;
  preview?: string;
  country?: string;
  phone?: boolean;
  target?: string;
}

export interface PendingPrompt {
  domain: string;
  username?: string;
  password: string;
  update: boolean;
  confirmed: boolean;
  reused?: number;
}

export interface TotpPrompt {
  domain: string;
  target?: string;
  replace: boolean;
}

export type AutofillRequest =
  | { type: "autofill:suggest" }
  | { type: "autofill:fill"; id: string }
  | { type: "autofill:generate" }
  | { type: "autofill:capture"; username?: string; password: string }
  | { type: "autofill:identifier"; username: string }
  | { type: "autofill:pending" }
  | { type: "autofill:confirm" }
  | { type: "autofill:save"; username?: string; password?: string }
  | { type: "autofill:dismiss"; never?: boolean }
  | { type: "autofill:open-popup" }
  | { type: "autofill:codes" }
  | { type: "autofill:code"; id: string }
  | { type: "autofill:totp-found"; text: string }
  | { type: "autofill:totp-save" }
  | { type: "autofill:totp-dismiss" }
  | { type: "autofill:qr-image"; url: string }
  | { type: "autofill:cards" }
  | { type: "autofill:card"; id: string }
  | { type: "autofill:identities"; field?: keyof AddressData }
  | { type: "autofill:identity"; id: string }
  | { type: "autofill:random-address"; country: string }
  | { type: "autofill:aliases" }
  | {
      type: "autofill:form-capture";
      card?: CapturedCard;
      untouched?: boolean;
      address?: AddressData;
      random?: boolean;
      lonePhone?: boolean;
    }
  | { type: "autofill:form-pending" }
  | { type: "autofill:form-save"; cvv?: boolean }
  | { type: "autofill:form-dismiss"; never?: boolean }
  | { type: "autofill:site-check" };

export interface CardFrameCapture {
  type: "autofill:card-frame-capture";
  card: CapturedCard;
  untouched: boolean;
  submit: boolean;
}

export type AutofillResponse =
  | { ok: true; locked: true }
  | { ok: true; locked: false; suggestions: Suggestion[]; domain: string }
  | { ok: true; credentials: { username?: string; password: string } }
  | { ok: true; password: string }
  | { ok: true; prompt: PendingPrompt | null }
  | { ok: true; saved: boolean; locked?: boolean; code?: string }
  | { ok: true; code: string }
  | { ok: true; totp: TotpPrompt | null }
  | { ok: true; image: string | null }
  | { ok: true; locked: false; cards: CardSuggestion[] }
  | { ok: true; card: CardData }
  | { ok: true; locked: false; identities: IdentitySuggestion[] }
  | { ok: true; identity: AddressData }
  | { ok: true; aliases: string[]; site: string }
  | { ok: true; form: FormPrompt | null }
  | { ok: true; lookalike: LookalikeMatch | null }
  | { ok: false; error: string };

export interface CardFrameFill {
  type: "7key:card-frame-fill";
  card: CardData;
}

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

function isCardBrand(value: unknown): value is CardBrand {
  return typeof value === "string" && Object.hasOwn(CARD_BRAND_NAMES, value);
}

export function isCardData(value: unknown): value is CardData {
  return (
    isPlainObject(value) &&
    typeof value.number === "string" &&
    isCardBrand(value.brand) &&
    isOptionalString(value.cardholder) &&
    isOptionalString(value.expiry) &&
    isOptionalString(value.cvv)
  );
}

export function isCardFrameFill(message: unknown): message is CardFrameFill {
  return (
    isPlainObject(message) && message.type === "7key:card-frame-fill" && isCardData(message.card)
  );
}

export function isCardFrameCapture(message: unknown): message is CardFrameCapture {
  return (
    isPlainObject(message) &&
    message.type === "autofill:card-frame-capture" &&
    isPlainObject(message.card) &&
    typeof message.untouched === "boolean" &&
    typeof message.submit === "boolean"
  );
}

export function isAutofillRequest(message: unknown): message is AutofillRequest {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === "string" && type.startsWith("autofill:");
}
