import type { PasskeyOption } from "./protocol.js";

export interface ConditionalPasskeys {
  list(): Promise<{ locked: boolean; passkeys: PasskeyOption[] }>;
  use(credentialId: string): Promise<boolean>;
}

const KEY = Symbol.for("1pw.passkey.conditional");

type Holder = { [KEY]?: ConditionalPasskeys | null };

export function setConditionalPasskeys(value: ConditionalPasskeys | null): void {
  (globalThis as Holder)[KEY] = value;
}

export function conditionalPasskeys(): ConditionalPasskeys | null {
  return (globalThis as Holder)[KEY] ?? null;
}
