import { signal } from "@preact/signals";
import { fromBase64, type Bytes } from "../../../src/core/bytes.js";
import { getUnlocked } from "../../lib/storage.js";
import { importKey } from "../../lib/vault.js";

export const vaultKeySignal = signal<CryptoKey | null>(null);
export const vaultKeyRawSignal = signal<Bytes | null>(null);

export async function refreshSession(): Promise<void> {
  const unlocked = await getUnlocked();
  vaultKeyRawSignal.value = unlocked ? fromBase64(unlocked.vaultKeyRaw) : null;
  vaultKeySignal.value = unlocked ? await importKey(unlocked.vaultKeyRaw) : null;
}
