import { signal } from "@preact/signals";
import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { Identity } from "../../src/core/identity.js";
import { describeError, type MessageKey } from "../../src/i18n/index.js";
import {
  getOrg,
  listOrgs,
  myInvites,
  type MyInvite,
  type OrgDetail,
  type OrgMember,
  type OrgSummary,
  type Team,
} from "../lib/orgs.js";
import { listProjects, type Project } from "../lib/projects.js";
import { useT } from "../ui/i18n.js";
import { location$, navigate } from "./router.js";

export const toast$ = signal<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string): void {
  toast$.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast$.value = null), 2400);
}

export type Run = (work: () => Promise<unknown>, done?: MessageKey) => Promise<boolean>;

export interface ConsoleData {
  identity: Identity;
  orgs: OrgSummary[];
  invites: MyInvite[];
  detail: OrgDetail;
  projects: Project[] | null;
  me: OrgMember | undefined;
  error: string | null;
  run: Run;
  reload: () => Promise<void>;
  emailOf: (accountId: string) => string;
  team: (teamId: string) => Team | undefined;
  myTeams: Team[];
}

export const ConsoleContext = createContext<ConsoleData | null>(null);

export function useConsole(): ConsoleData {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error("useConsole outside the console");
  return value;
}

export function useConsoleLoader(identity: Identity) {
  const t = useT();
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wanted = location$.value.orgId;

  const reload = async () => {
    const [list, pending] = await Promise.all([listOrgs(), myInvites()]);
    setOrgs(list);
    setInvites(pending);
    const current = list.find((org) => org.id === location$.value.orgId) ?? list[0];
    if (!current) {
      setDetail(null);
      setProjects([]);
      return;
    }
    if (current.id !== location$.value.orgId) navigate(current.id, location$.value.route);
    const next = await getOrg(current.id);
    setDetail(next);
    const mine = next.teams.filter((team) => team.wrappedKey);
    const lists = await Promise.all(mine.map((team) => listProjects(next.org.id, team, identity)));
    setProjects(lists.flat().sort((a, b) => a.content.name.localeCompare(b.content.name)));
  };

  const run: Run = async (work, done) => {
    setError(null);
    try {
      await work();
      if (done) toast(t(done));
      await reload();
      return true;
    } catch (failure) {
      setError(describeError(failure, t));
      return false;
    }
  };

  useEffect(() => {
    void reload().catch((failure) => setError(describeError(failure, t)));
  }, [identity, wanted]);

  const data: ConsoleData | null =
    orgs && detail
      ? {
          identity,
          orgs,
          invites,
          detail,
          projects,
          me: detail.members.find((member) => member.publicKey === identity.publicKey),
          error,
          run,
          reload,
          emailOf: (accountId) =>
            detail.members.find((member) => member.accountId === accountId)?.email ??
            t("console.former_member"),
          team: (teamId) => detail.teams.find((team) => team.id === teamId),
          myTeams: detail.teams.filter((team) => team.wrappedKey),
        }
      : null;

  return { data, orgs, invites, error, run, setError };
}
