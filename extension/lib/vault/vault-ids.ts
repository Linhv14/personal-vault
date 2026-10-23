const SHARED_PREFIX = "team:";

export function sharedVaultId(orgId: string, teamId: string): string {
  return `${SHARED_PREFIX}${orgId}:${teamId}`;
}

export function isSharedVaultId(id: string | undefined): id is string {
  return typeof id === "string" && id.startsWith(SHARED_PREFIX);
}

export function sharedVaultParts(id: string): { orgId: string; teamId: string } {
  const [orgId = "", teamId = ""] = id.slice(SHARED_PREFIX.length).split(":");
  return { orgId, teamId };
}
