import { importVaultKey, openJson, sealJson } from "../../src/core/crypto.js";
import { fromBase64, utf8Encode } from "../../src/core/bytes.js";
import * as api from "./api.js";
import { platform } from "./platform.js";
import { autoLockMinutes, getLocal, getUnlocked, LOCK_NEVER, setLocal, unlock } from "./storage.js";

const RESUME_CONTEXT = utf8Encode("personal-vault/resume");

export async function rememberUnlock(vaultKeyRaw: string, token: string | undefined) {
  if (!token || (await autoLockMinutes()) !== LOCK_NEVER) {
    await forgetUnlock();
    return;
  }
  try {
    const resumeKey = await importVaultKey(fromBase64(await api.resumeKey(token)));
    const sealed = await sealJson(resumeKey, { vaultKeyRaw }, RESUME_CONTEXT);
    await setLocal({ resume: { token, sealed } });
  } catch {
    await forgetUnlock();
  }
}

export async function forgetUnlock(): Promise<void> {
  await platform().local.remove("resume");
}

export async function resumeUnlock(): Promise<boolean> {
  if (await getUnlocked()) {
    return true;
  }
  const { resume } = await getLocal();
  if (!resume || (await autoLockMinutes()) !== LOCK_NEVER) {
    return false;
  }
  try {
    const resumeKey = await importVaultKey(fromBase64(await api.resumeKey(resume.token)));
    const { vaultKeyRaw } = await openJson<{ vaultKeyRaw: string }>(
      resumeKey,
      resume.sealed,
      RESUME_CONTEXT,
    );
    await unlock(vaultKeyRaw, resume.token);
    return true;
  } catch (error) {
    const offline = error instanceof api.ApiError && error.status === 0;
    if (!offline) {
      await forgetUnlock();
    }
    return false;
  }
}
