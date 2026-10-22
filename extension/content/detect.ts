import { isPaymentFrameUrl } from "#core/payment-frames.js";
import { conditionalPasskeys } from "../lib/passkey/conditional.js";
import { detectFields, formKindOf, type FormKind } from "./forms/classify.js";
import { isOneTimeCodeField } from "./two-factor.js";

const USERNAME_HINT = /user|email|login|account|phone|mobile|identifier/i;
const NEW_PASSWORD_HINT = /new|confirm|repeat|register|signup|sign-up|sign_up|create|join/i;
const SIGN_UP_BUTTON =
  /sign\s?up|create( an)? account|register|join|get started|đăng ký|tạo tài khoản/i;

export function isVisible(input: HTMLElement): boolean {
  const rect = input.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(input).visibility !== "hidden";
}

export function passwordFields(scope: ParentNode = document): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(isVisible);
}

export function scopeOf(input: HTMLInputElement): ParentNode {
  return input.form ?? document;
}

function describe(input: HTMLInputElement): string {
  return [input.name, input.id, input.autocomplete, input.getAttribute("aria-label") ?? ""].join(
    " ",
  );
}

export const USERNAME_INPUTS =
  'input[type="email"], input[type="text"], input[type="tel"], input:not([type])';

export function namesAccount(input: HTMLInputElement): boolean {
  return /username|email/.test(input.autocomplete) || USERNAME_HINT.test(describe(input));
}

export function findUsernameField(password: HTMLInputElement): HTMLInputElement | null {
  const candidates = [
    ...scopeOf(password).querySelectorAll<HTMLInputElement>(USERNAME_INPUTS),
  ].filter(
    (input) =>
      isVisible(input) &&
      password.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  const nearestFirst = candidates.reverse();
  return (
    nearestFirst.find((input) => /username|email/.test(input.autocomplete)) ??
    nearestFirst.find(namesAccount) ??
    nearestFirst[0] ??
    null
  );
}

export function findPasswordFor(input: HTMLInputElement): HTMLInputElement | null {
  if (input.type === "password") {
    return input;
  }
  return (
    passwordFields(scopeOf(input)).find(
      (field) => input.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ) ?? null
  );
}

export function wantsNewPassword(password: HTMLInputElement): boolean {
  if (password.autocomplete === "new-password") {
    return true;
  }
  if (passwordFields(scopeOf(password)).length >= 2) {
    return true;
  }
  if (password.autocomplete === "current-password") {
    return false;
  }
  const formAction = password.form?.getAttribute("action") ?? "";
  if (NEW_PASSWORD_HINT.test(`${describe(password)} ${formAction} ${location.pathname}`)) {
    return true;
  }
  const buttons = [
    ...scopeOf(password).querySelectorAll<HTMLElement>(
      'button, input[type="submit"], [role="button"]',
    ),
  ];
  return buttons.some((button) =>
    SIGN_UP_BUTTON.test(button.textContent || (button as HTMLInputElement).value || ""),
  );
}

function wantsPasskey(input: HTMLInputElement): boolean {
  return (
    conditionalPasskeys() !== null &&
    input.type !== "password" &&
    input.autocomplete.split(/\s+/).includes("webauthn")
  );
}

function isLoginUsername(input: HTMLInputElement): boolean {
  const password = findPasswordFor(input);
  return input.type !== "password" && password !== null && findUsernameField(password) === input;
}

export function formKind(input: HTMLInputElement): FormKind | null {
  if (input.type === "password" || wantsPasskey(input) || isLoginUsername(input)) {
    return null;
  }
  return formKindOf(input, detectFields(scopeOf(input)));
}

export function isCodeField(input: HTMLInputElement): boolean {
  return isOneTimeCodeField(input) && formKind(input) !== "card";
}

const TEXT_INPUT_TYPES = new Set(["text", "email", "tel", "password", "search", "url", "number"]);

export function isDecoratable(input: HTMLInputElement): boolean {
  if (!TEXT_INPUT_TYPES.has(input.type)) {
    return false;
  }
  if (input.type === "password" || wantsPasskey(input) || isCodeField(input)) {
    return true;
  }
  return isLoginUsername(input) || formKind(input) !== null;
}

export function isEmailInput(input: HTMLInputElement): boolean {
  return (
    input.type === "email" || /e-?mail/i.test(`${input.autocomplete} ${input.name} ${input.id}`)
  );
}

export function hasPaymentFrames(scope: ParentNode): boolean {
  return [...scope.querySelectorAll("iframe")].some((frame) => isPaymentFrameUrl(frame.src));
}
