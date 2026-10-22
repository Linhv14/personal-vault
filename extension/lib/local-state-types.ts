import type { KdfParams, SealedData } from "#core/crypto.js";
import type { LocalePreference } from "#i18n/index.js";

export interface CachedItem {
  id: string;
  ciphertext: string | null;
  nonce: string | null;
  updatedAt: number;
  deletedAt: number | null;
}

export interface LocalState {
  apiUrl?: string;
  email?: string;
  kdf?: KdfParams;
  wrappedVaultKey?: SealedData;
  items?: CachedItem[];
  lastSync?: number;
  unboundItemsMigrated?: boolean;
  aadBoundAccounts?: string[];
  autofillPromoDismissed?: boolean;
  neverAskForms?: string[];
  neverAskLogins?: string[];
  sharedLinks?: SealedData;
  autoLockMinutes?: number;
  hasPasskeys?: boolean;
  clockSkew?: number;
  locale?: LocalePreference;
  showLogos?: boolean;
  resume?: { token: string; sealed: SealedData };
  pin?: { token: string; salt: string; iterations: number; sealed: SealedData };
  biometric?: { token: string; credentialId: string; secret: string; sealed: SealedData };
  biometricPromoDismissed?: boolean;
  identity?: { publicKey: string; wrappedPrivateKey: SealedData };
  sharedVaults?: CachedSharedVault[];
  sharedGenerations?: Record<string, number>;
}

export interface CachedSharedVault {
  orgId: string;
  orgName: string;
  teamId: string;
  name: string;
  generation: number;
  rekeyNeeded: boolean;
  viewOnly?: boolean;
  wrappedKey: { ephemeralPublicKey: string; sealed: SealedData };
  items: { id: string; sealed: SealedData; updatedAt: number; updatedBy: string }[];
}
