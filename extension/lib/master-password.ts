import {
  checkMasterPassword,
  masterPasswordIssue,
  type MasterPasswordIssue,
} from "#core/master-password.js";
import type { MessageKey } from "#i18n/index.js";
import { breachCounts, fetchBreachRange, type FetchRange } from "./health.js";

export function masterPasswordMessage(issue: MasterPasswordIssue): {
  key: MessageKey;
  params: Record<string, number>;
} {
  switch (issue.code) {
    case "too_short":
      return { key: "password.too_short", params: { min: issue.min } };
    case "too_long":
      return { key: "password.too_long", params: { max: issue.max } };
    case "matches_email":
      return { key: "password.matches_email", params: {} };
    case "breached":
      return { key: "password.breached", params: { count: issue.count } };
  }
}

export class MasterPasswordRejected extends Error {
  readonly messageKey: MessageKey;
  readonly params: Record<string, number>;

  constructor(readonly issue: MasterPasswordIssue) {
    super(`Master password rejected: ${issue.code}`);
    this.name = "MasterPasswordRejected";
    const { key, params } = masterPasswordMessage(issue);
    this.messageKey = key;
    this.params = params;
  }
}

export function assertMasterPasswordPolicy(password: string, email: string): void {
  const issue = masterPasswordIssue(password, email);
  if (issue) {
    throw new MasterPasswordRejected(issue);
  }
}

export function checkNewMasterPassword(
  password: string,
  email: string,
  fetchRange: FetchRange = fetchBreachRange,
): Promise<MasterPasswordIssue | null> {
  return checkMasterPassword(
    password,
    email,
    async (candidate) => (await breachCounts([candidate], fetchRange)).get(candidate) ?? 0,
  );
}
