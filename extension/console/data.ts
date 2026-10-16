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
import { listProjects, openProjects, type Project } from "../lib/projects.js";
import { useT } from "../ui/i18n.js";
import { location$, navigate } from "./router.js";

export type ToastKind = "success" | "error" | "info";

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
}

export const toasts$ = signal<ToastEntry[]>([]);
const MAX_TOASTS = 3;
const TOAST_MS: Record<ToastKind, number> = { success: 2800, info: 2800, error: 6000 };
let toastId = 0;

export function dismissToast(id: number): void {
  toasts$.value = toasts$.value.filter((entry) => entry.id !== id);
}

export function toast(message: string, kind: ToastKind = "success"): void {
  const id = ++toastId;
  const rest = toasts$.value.filter((entry) => entry.message !== message);
  toasts$.value = [...rest, { id, kind, message }].slice(-MAX_TOASTS);
  setTimeout(() => dismissToast(id), TOAST_MS[kind]);
}

export const refreshing$ = signal(false);

function dialogOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector("dialog[open]") !== null;
}

let lastOrgId: string | null = null;

interface Snapshot {
  guess: string | null;
  list: OrgSummary[];
  pending: MyInvite[];
  early: OrgDetail | null;
}

let prefetched: Promise<Snapshot> | null = null;

async function snapshot(): Promise<Snapshot> {
  const id = location$.value.orgId ?? lastOrgId;
  const guess = id && id !== "new" ? id : null;
  const [list, pending, early] = await Promise.all([
    listOrgs(),
    myInvites(),
    guess ? getOrg(guess).catch(() => null) : Promise.resolve(null),
  ]);
  return { guess, list, pending, early };
}

export function prefetchConsole(): void {
  prefetched = snapshot();
  prefetched.catch(() => (prefetched = null));
}

export const pending$ = signal(false);
export const failure$ = signal<string | null>(null);

export async function attempt(
  work: () => Promise<unknown>,
  describe: (failure: unknown) => string,
): Promise<boolean> {
  if (pending$.value) return false;
  failure$.value = null;
  pending$.value = true;
  try {
    await work();
    return true;
  } catch (failure) {
    const message = describe(failure);
    if (dialogOpen()) failure$.value = message;
    else toast(message, "error");
    return false;
  } finally {
    pending$.value = false;
  }
}

export type ReloadScope = "all" | "org";

export type Run = (
  work: () => Promise<unknown>,
  done?: MessageKey,
  scope?: ReloadScope,
) => Promise<boolean>;

export interface ConsoleData {
  identity: Identity;
  orgs: OrgSummary[];
  invites: MyInvite[];
  detail: OrgDetail;
  projects: Project[] | null;
  me: OrgMember | undefined;
  error: string | null;
  run: Run;
  reload: (scope?: ReloadScope) => Promise<void>;
  refreshing: boolean;
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
  const wanted = location$.value.orgId ?? lastOrgId;

  const fetchAll = async () => {
    const ready = prefetched ?? snapshot();
    prefetched = null;
    const { guess, list, pending, early } = await ready;
    setOrgs(list);
    setInvites(pending);
    const current = list.find((org) => org.id === guess) ?? list[0];
    if (!current) {
      setDetail(null);
      setProjects([]);
      return;
    }
    lastOrgId = current.id;
    const { orgId, route } = location$.value;
    if (route.page !== "me" && route.page !== "invite" && current.id !== orgId) {
      navigate(current.id, route);
    }
    const next = (current.id === guess && early) || (await getOrg(current.id));
    setDetail(next);
    setProjects(await projectsOf(next));
  };

  const projectsOf = async (next: OrgDetail) => {
    const mine = next.teams.filter((team) => team.wrappedKey);
    const lists = await Promise.all(
      mine.map((team) => {
        const listed = next.projects?.[team.id];
        return listed
          ? openProjects(team, listed, identity)
          : listProjects(next.org.id, team, identity);
      }),
    );
    return lists.flat().sort((a, b) => a.content.name.localeCompare(b.content.name));
  };

  const fetchOrg = async () => {
    const orgId = location$.value.orgId ?? lastOrgId;
    if (!orgId || orgId !== detail?.org.id) return fetchAll();
    const next = await getOrg(orgId);
    const opened = await projectsOf(next);
    setDetail(next);
    setProjects(opened);
  };

  const reload = async (scope: ReloadScope = "all") => {
    refreshing$.value = true;
    try {
      await (scope === "org" ? fetchOrg() : fetchAll());
    } finally {
      refreshing$.value = false;
    }
  };

  const run: Run = async (work, done, scope = "all") => {
    setError(null);
    const succeeded = await attempt(
      async () => {
        await work();
        if (done) toast(t(done));
        await reload(scope);
      },
      (failure) => describeError(failure, t),
    );
    return succeeded;
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
          refreshing: refreshing$.value,
          emailOf: (accountId) =>
            detail.members.find((member) => member.accountId === accountId)?.email ??
            t("console.former_member"),
          team: (teamId) => detail.teams.find((team) => team.id === teamId),
          myTeams: detail.teams.filter((team) => team.wrappedKey),
        }
      : null;

  return { data, orgs, invites, error, run, setError };
}
