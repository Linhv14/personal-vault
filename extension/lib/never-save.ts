import { getLocal, setLocal, type LocalState } from "./storage.js";

export type SaveKind = "logins" | "forms";

const FIELDS = { logins: "neverAskLogins", forms: "neverAskForms" } as const;

export interface NeverSaveSite {
  domain: string;
  logins: boolean;
  forms: boolean;
}

export async function neverSaves(kind: SaveKind, domain: string): Promise<boolean> {
  return ((await getLocal())[FIELDS[kind]] ?? []).includes(domain);
}

export async function stopSaving(kind: SaveKind, domain: string): Promise<void> {
  const current = (await getLocal())[FIELDS[kind]] ?? [];
  if (!current.includes(domain)) {
    await setLocal({ [FIELDS[kind]]: [...current, domain] });
  }
}

export async function allowSaving(domain: string): Promise<void> {
  const local = await getLocal();
  await setLocal({
    neverAskLogins: (local.neverAskLogins ?? []).filter((site) => site !== domain),
    neverAskForms: (local.neverAskForms ?? []).filter((site) => site !== domain),
  });
}

export function neverSaveSites(local: LocalState): NeverSaveSite[] {
  const logins = local.neverAskLogins ?? [];
  const forms = local.neverAskForms ?? [];
  return [...new Set([...logins, ...forms])]
    .sort((a, b) => a.localeCompare(b))
    .map((domain) => ({ domain, logins: logins.includes(domain), forms: forms.includes(domain) }));
}
