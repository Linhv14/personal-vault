import { signal } from "@preact/signals";
import { resumeUnlock } from "../lib/resume.js";
import { getLocal, type LocalState } from "../lib/storage.js";
import { setUiLocale } from "../ui/i18n.js";
import { toast } from "../ui/store/feedback.js";
import { refreshSession } from "../ui/store/session.js";

export const localState = signal<LocalState>({});

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
    if (area === "session") {
      void refreshSession();
    }
    if (area === "local" && Object.keys(changes).length > 0) {
      void reloadLocal();
    }
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}

export { currentAuthKey } from "../lib/reauth.js";

export function isSignedIn(local: LocalState): boolean {
  return Boolean(local.email && local.wrappedVaultKey);
}
