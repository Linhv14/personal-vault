import { utf8Encode, type Bytes } from "./bytes.js";
import { importVaultKey, openJson, sealJson, type SealedData } from "./crypto.js";

export const MAX_TEAM_ITEMS = 1000;
export const MAX_TEAM_ITEM_BYTES = 64 * 1024;

export interface TeamItemAddress {
  teamId: string;
  generation: number;
  itemId: string;
}

function teamItemContext({ teamId, generation, itemId }: TeamItemAddress): Bytes {
  return utf8Encode(`personal-vault/team-item/${teamId}/${generation}/${itemId}`);
}

export async function sealTeamItem<T>(
  teamKey: Bytes,
  address: TeamItemAddress,
  content: T,
): Promise<SealedData> {
  return sealJson(await importVaultKey(teamKey), content, teamItemContext(address));
}

export async function openTeamItem<T>(
  teamKey: Bytes,
  address: TeamItemAddress,
  sealed: SealedData,
): Promise<T> {
  return openJson<T>(await importVaultKey(teamKey), sealed, teamItemContext(address));
}
