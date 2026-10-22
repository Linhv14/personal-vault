import { utf8Encode } from "../../src/core/bytes.js";
import { openJson, sealJson } from "../../src/core/crypto.js";
import { getLocal, setLocal } from "./storage.js";

export interface SharedLink {
  id: string;
  url: string;
  itemId: string;
  title: string;
  createdAt: number;
  expiresAt: number;
  maxViews: number | null;
  recipients: string[];
  hasPassphrase: boolean;
  revokeToken: string;
}

const ASSOCIATED_DATA = utf8Encode("personal-vault/shared-links");

export async function loadSharedLinks(key: CryptoKey): Promise<SharedLink[]> {
  const { sharedLinks } = await getLocal();
  if (!sharedLinks) {
    return [];
  }
  return openJson<SharedLink[]>(key, sharedLinks, ASSOCIATED_DATA);
}

export async function saveSharedLinks(key: CryptoKey, links: SharedLink[]): Promise<void> {
  await setLocal({ sharedLinks: await sealJson(key, links, ASSOCIATED_DATA) });
}

export async function rememberSharedLink(key: CryptoKey, link: SharedLink): Promise<void> {
  await saveSharedLinks(key, [link, ...(await loadSharedLinks(key))]);
}

export async function forgetSharedLink(key: CryptoKey, id: string): Promise<void> {
  const links = await loadSharedLinks(key);
  await saveSharedLinks(
    key,
    links.filter((link) => link.id !== id),
  );
}
