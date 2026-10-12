export const AUTOFILL_SCRIPT_ID = "personal-vault-autofill";
export const AUTOFILL_ORIGINS = ["https://*/*", "http://*/*"];

export interface Suggestion {
  id: string;
  title: string;
  username?: string;
}

export interface PendingPrompt {
  domain: string;
  username?: string;
  update: boolean;
}

export type AutofillRequest =
  | { type: "autofill:suggest" }
  | { type: "autofill:fill"; id: string }
  | { type: "autofill:generate" }
  | { type: "autofill:capture"; username?: string; password: string }
  | { type: "autofill:pending" }
  | { type: "autofill:save" }
  | { type: "autofill:dismiss" }
  | { type: "autofill:open-popup" };

export type AutofillResponse =
  | { ok: true; locked: true }
  | { ok: true; locked: false; suggestions: Suggestion[]; domain: string }
  | { ok: true; credentials: { username?: string; password: string } }
  | { ok: true; password: string }
  | { ok: true; prompt: PendingPrompt | null }
  | { ok: true; saved: boolean; locked?: boolean }
  | { ok: false; error: string };

export function isAutofillRequest(message: unknown): message is AutofillRequest {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === "string" && type.startsWith("autofill:");
}
