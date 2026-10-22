export type ErrorCode =
  | "base32.invalid_character"
  | "totp.empty_secret"
  | "totp.invalid_uri"
  | "totp.not_totp"
  | "totp.missing_secret"
  | "totp.unsupported_algorithm"
  | "totp.unrecognized_input"
  | "crypto.unsupported_kdf"
  | "crypto.empty_password"
  | "crypto.wrong_password"
  | "crypto.bad_key_length"
  | "share.passphrase_required"
  | "share.invalid_key"
  | "share.wrong_passphrase"
  | "share.undecryptable"
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
