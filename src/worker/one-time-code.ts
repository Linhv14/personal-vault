import { randomInt } from "../core/generator.js";

export const CODE_RESEND_COOLDOWN_SECONDS = 60;
export const CODE_MAX_ATTEMPTS = 5;

export function isCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export function generateCode(): string {
  return String(randomInt(1_000_000)).padStart(6, "0");
}
