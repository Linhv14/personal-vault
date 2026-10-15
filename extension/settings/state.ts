import { signal } from "@preact/signals";
import {
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  open as openSealed,
} from "../../src/core/crypto.js";
import { toBase64 } from "../../src/core/bytes.js";
import { resumeUnlock } from "../lib/resume.js";
import { getLocal, type LocalState } from "../lib/storage.js";
import { setUiLocale } from "../ui/i18n.js";
import { refreshSession } from "../ui/store/session.js";
import { toast, toast$ } from "../console/data.js";

export const localState = signal<LocalState>({});
export const toastMessage = toast$;

export function showToast(message: string): void {
  toast(message);
}

export async function reloadLocal(): Promise<void> {
  const next = await getLocal();
  setUiLocale(next.locale);
  localState.value = next;
}

export function watchStorage(): () => void {
  void reloadLocal();
  void resumeUnlock().then(() => refreshSession());
  const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area === "session") void refreshSession();
    if (area === "local" && Object.keys(changes).length > 0) void reloadLocal();
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}

export async function currentAuthKey(password: string): Promise<string | null> {
  const local = await getLocal();
  if (!local.email || !local.kdf || !local.wrappedVaultKey) return null;
  try {
    const masterKey = await deriveMasterKey(local.email, password, local.kdf);
    await openSealed(await deriveWrappingKey(masterKey), local.wrappedVaultKey);
    return toBase64(await deriveAuthKey(masterKey));
  } catch {
    return null;
  }
}

export function isSignedIn(local: LocalState): boolean {
  return Boolean(local.email && local.wrappedVaultKey);
}
