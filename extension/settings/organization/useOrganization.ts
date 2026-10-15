import { useEffect, useRef, useState } from "preact/hooks";
import type { Identity } from "../../../src/core/identity.js";
import { describeError, type MessageKey } from "../../../src/i18n/index.js";
import { ensureIdentity } from "../../lib/identity.js";
import {
  auditLog,
  getOrg,
  isOrgAdmin,
  listOrgs,
  myInvites,
  type AuditPage,
  type MyInvite,
  type OrgDetail,
  type OrgSummary,
} from "../../lib/orgs.js";
import { useT } from "../../ui/i18n.js";
import { showToast } from "../state.js";

export function useOrganization(vaultKey: CryptoKey | null) {
  const t = useT();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [audit, setAudit] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = useRef<string | null>(null);

  const reload = async () => {
    const [list, pending] = await Promise.all([listOrgs(), myInvites()]);
    setOrgs(list);
    setInvites(pending);
    const current = list.find((org) => org.id === selected.current) ?? list[0] ?? null;
    selected.current = current?.id ?? null;
    setOrgId(selected.current);
    const next = current ? await getOrg(current.id) : null;
    setDetail(next);
    setAudit(next && isOrgAdmin(next.org.role) ? await auditLog(next.org.id) : null);
  };

  const run = async (work: () => Promise<unknown>, done?: MessageKey) => {
    setError(null);
    try {
      await work();
      if (done) showToast(t(done));
      await reload();
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  useEffect(() => {
    if (!vaultKey) return;
    void ensureIdentity(vaultKey)
      .then(setIdentity)
      .then(() => reload())
      .catch((failure) => setError(describeError(failure, t)));
  }, [vaultKey]);

  const select = async (id: string) => {
    selected.current = id;
    await reload();
  };

  return { identity, orgs, invites, orgId, detail, audit, error, run, select, selected };
}
