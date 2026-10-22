import { signal } from "@preact/signals";
import { describeError } from "../../src/i18n/index.js";
import {
  autofillSupported,
  enableAutofill,
  isAutofillEnabled,
} from "../lib/autofill-permission.js";
import {
  BiometricError,
  biometricLabel,
  biometricSupported,
  enableBiometric,
} from "../lib/biometric.js";
import { listOrgs, myInvites, type MyInvite } from "../lib/orgs.js";
import { getLocal, setLocal } from "../lib/storage.js";
import { toast, translator } from "./state.js";

export type Promo = "biometric" | "invites" | "autofill";

interface OrgSnapshot {
  orgs: number;
  invites: MyInvite[];
}

const ORG_SNAPSHOT_KEY = "orgSnapshot";

export const orgSnapshot = signal<OrgSnapshot | null>(null);
export const activePromo = signal<Promo | null>(null);

const available = { biometric: false, autofill: false };
let invitesDismissed = false;

function pickPromo(): void {
  const invited = (orgSnapshot.value?.invites.length ?? 0) > 0 && !invitesDismissed;
  activePromo.value = available.biometric
    ? "biometric"
    : invited
      ? "invites"
      : available.autofill
        ? "autofill"
        : null;
}

async function refreshOrgs(): Promise<void> {
  const cached = (await chrome.storage.session.get(ORG_SNAPSHOT_KEY))[ORG_SNAPSHOT_KEY] as
    OrgSnapshot | undefined;
  if (cached) {
    orgSnapshot.value = cached;
  }
  try {
    const [orgs, invites] = await Promise.all([listOrgs(), myInvites()]);
    const fresh = { orgs: orgs.length, invites };
    orgSnapshot.value = fresh;
    await chrome.storage.session.set({ [ORG_SNAPSHOT_KEY]: fresh });
  } catch {
    orgSnapshot.value ??= { orgs: 0, invites: [] };
  }
}

async function refreshDevicePromos(): Promise<void> {
  const { biometric, biometricPromoDismissed, autofillPromoDismissed } = await getLocal();
  available.biometric = !biometric && !biometricPromoDismissed && (await biometricSupported());
  available.autofill =
    autofillSupported() && !autofillPromoDismissed && !(await isAutofillEnabled());
  if (available.autofill) {
    await setLocal({ autofillPromoDismissed: true });
  }
}

export async function refreshPromos(): Promise<void> {
  await Promise.all([refreshOrgs(), refreshDevicePromos()]);
  pickPromo();
}

export async function dismissPromo(promo: Promo): Promise<void> {
  if (promo === "biometric") {
    available.biometric = false;
    await setLocal({ biometricPromoDismissed: true });
  } else if (promo === "autofill") {
    available.autofill = false;
    await setLocal({ autofillPromoDismissed: true });
  } else {
    invitesDismissed = true;
  }
  pickPromo();
}

export async function acceptPromo(promo: Promo): Promise<void> {
  const t = translator();
  if (promo === "autofill") {
    if (!(await enableAutofill())) {
      return;
    }
    toast(t("settings.autofill_enabled"));
    available.autofill = false;
  } else if (promo === "biometric") {
    const method = t(biometricLabel());
    try {
      await enableBiometric();
      available.biometric = false;
      toast(t("bio.enabled", { method }));
    } catch (error) {
      toast(
        error instanceof BiometricError ? t("bio.cancelled", { method }) : describeError(error, t),
      );
    }
  }
  pickPromo();
}
