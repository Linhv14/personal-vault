/**
 * Error codes shared by every layer.
 *
 * `src/core` must never produce user-facing prose. It throws a `VaultError`
 * carrying a stable `code`; the UI layer turns that code into a localized
 * message. If core threw human sentences instead, the UI would have to match on
 * them, and every wording fix would silently break a translation.
 *
 * The `message` on these errors is for developers — logs, stack traces, tests.
 * It stays in English and is never shown to a user.
 */

export type ErrorCode =
  // base32 / TOTP
  | "base32.invalid_character"
  | "totp.empty_secret"
  | "totp.invalid_uri"
  | "totp.not_totp"
  | "totp.missing_secret"
  | "totp.unsupported_algorithm"
  | "totp.unrecognized_input"
  // crypto
  | "crypto.unsupported_kdf"
  | "crypto.empty_password"
  | "crypto.wrong_password"
  | "crypto.bad_key_length"
  // share
  | "share.passphrase_required"
  | "share.invalid_key"
  | "share.wrong_passphrase"
  | "share.undecryptable"
  // generator
  | "generator.no_character_set"
  | "generator.length_too_short"
  | "generator.length_too_long"
  | "generator.too_few_words"
  | "generator.too_many_words"
  | "generator.wordlist_too_small"
  | "generator.pin_length_out_of_range"
  | "generator.invalid_max";

export interface ErrorParams {
  [key: string]: string | number;
}

export class VaultError extends Error {
  constructor(
    readonly code: ErrorCode,
    /** Values interpolated into the localized message, e.g. `{ min: 4 }`. */
    readonly params: ErrorParams = {},
    developerMessage?: string,
  ) {
    super(developerMessage ?? code);
    this.name = "VaultError";
  }
}

export function isVaultError(error: unknown): error is VaultError {
  return error instanceof VaultError;
}
