import { isPlainObject, isString } from "#core/json.js";
import { ApiError } from "#ext/lib/api.js";
import { readOutcome } from "#commercial/core/sso-model.js";
import { startSsoSession, type SsoSession } from "./api.js";

const START = "sso:start";
const PENDING_KEY = "ssoPending";
const PENDING_TTL_MS = 10 * 60_000;

export interface SsoAttempt {
  server: string;
  authorizeUrl: string;
  verifier: string;
  expectedEmail: string | null;
  locale: string;
}

export interface SsoFailure {
  messageKey: string;
  params: Record<string, string | number>;
}

export type SsoPending = { at: number; server: string } & (
  { session: SsoSession } | { failure: SsoFailure }
);

export function startInBackground(attempt: SsoAttempt): void {
  void chrome.runtime.sendMessage({ type: START, ...attempt });
}

export function isSsoStart(message: unknown): message is SsoAttempt & { type: typeof START } {
  return (
    isPlainObject(message) &&
    message.type === START &&
    isString(message.server) &&
    isString(message.authorizeUrl) &&
    isString(message.verifier) &&
    isString(message.locale) &&
    (message.expectedEmail === null || isString(message.expectedEmail))
  );
}

async function settle(attempt: SsoAttempt, url: string): Promise<SsoSession | SsoFailure> {
  const outcome = readOutcome(url);
  if (!outcome?.grant) {
    return { messageKey: `error.${outcome?.error ?? "sso.failed"}`, params: {} };
  }
  try {
    const session = await startSsoSession(
      attempt.server,
      outcome.grant,
      attempt.verifier,
      attempt.locale,
    );
    if (attempt.expectedEmail && session.email !== attempt.expectedEmail) {
      return { messageKey: "sso.wrong_account", params: { email: session.email } };
    }
    return session;
  } catch (failure) {
    return failure instanceof ApiError
      ? { messageKey: failure.messageKey, params: failure.params }
      : { messageKey: "error.sso.failed", params: {} };
  }
}

export async function runSsoAttempt(attempt: SsoAttempt): Promise<void> {
  const url = new URL(attempt.authorizeUrl);
  if (url.protocol !== "https:") {
    return;
  }
  const returned = await chrome.identity
    .launchWebAuthFlow({ url: url.href, interactive: true })
    .catch(() => undefined);
  if (!returned) {
    return;
  }
  const result = await settle(attempt, returned);
  const base = { at: Date.now(), server: attempt.server };
  const pending: SsoPending =
    "status" in result ? { ...base, session: result } : { ...base, failure: result };
  await chrome.storage.session.set({ [PENDING_KEY]: pending });
  await chrome.action.openPopup().catch(() => undefined);
}

function fresh(value: unknown): SsoPending | null {
  if (
    !isPlainObject(value) ||
    typeof value.at !== "number" ||
    !isString(value.server) ||
    Date.now() - value.at > PENDING_TTL_MS
  ) {
    return null;
  }
  return isPlainObject(value.session) || isPlainObject(value.failure)
    ? (value as unknown as SsoPending)
    : null;
}

export async function readPending(): Promise<SsoPending | null> {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  return fresh(stored[PENDING_KEY]);
}

export async function clearPending(): Promise<void> {
  await chrome.storage.session.remove(PENDING_KEY);
}

export function watchPending(onChange: (pending: SsoPending | null) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "session" && PENDING_KEY in changes) {
      onChange(fresh(changes[PENDING_KEY].newValue));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
