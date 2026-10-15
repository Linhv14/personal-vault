import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Identity } from "../../../src/core/identity.js";
import type { MessageKey } from "../../../src/i18n/index.js";
import type { AuditPage, OrgDetail } from "../../lib/orgs.js";

export type Run = (work: () => Promise<unknown>, done?: MessageKey) => Promise<void>;

export interface OrgContextValue {
  detail: OrgDetail;
  identity: Identity;
  audit: AuditPage | null;
  run: Run;
}

export const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg() {
  const value = useContext(OrgContext);
  if (!value) throw new Error("useOrg outside an organization");
  const { detail } = value;
  const emailOf = (accountId: string) =>
    detail.members.find((member) => member.accountId === accountId)?.email ?? accountId;
  const isMe = (publicKey: string | null) => publicKey === value.identity.publicKey;
  return { ...value, emailOf, isMe };
}
