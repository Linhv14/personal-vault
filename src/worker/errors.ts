/**
 * API error responses.
 *
 * Every failure carries a stable `code` plus an English `error` sentence. The
 * extension localizes the code; the sentence is there so anyone poking at the
 * API with curl gets something readable without consulting a table.
 *
 * Codes are deliberately coarse. Telling an attacker precisely which field of a
 * login attempt was wrong is a gift, so several distinct causes share one code
 * on purpose — see `auth.invalid_credentials` and `shares.gone`.
 */

export type ApiErrorCode =
  | "auth.bad_registration_token"
  | "auth.invalid_body"
  | "auth.invalid_email"
  | "auth.invalid_kdf"
  | "auth.invalid_auth_key"
  | "auth.invalid_wrapped_key"
  | "auth.email_taken"
  | "auth.invalid_credentials"
  | "auth.rate_limited"
  | "auth.unauthorized"
  | "items.invalid_id"
  | "items.invalid_payload"
  | "items.forbidden"
  | "items.not_found"
  | "shares.invalid_payload"
  | "shares.invalid_ttl"
  | "shares.invalid_max_views"
  | "shares.gone"
  | "server.rate_limited"
  | "server.not_found"
  | "server.error";

const MESSAGES: Record<ApiErrorCode, string> = {
  "auth.bad_registration_token": "Invalid registration token",
  "auth.invalid_body": "Request body is not valid JSON",
  "auth.invalid_email": "Invalid email address",
  "auth.invalid_kdf": "Invalid KDF parameters",
  "auth.invalid_auth_key": "Invalid auth key",
  "auth.invalid_wrapped_key": "Invalid wrapped vault key",
  "auth.email_taken": "That email is already registered",
  "auth.invalid_credentials": "Incorrect email or master password",
  "auth.rate_limited": "Too many attempts, try again later",
  "auth.unauthorized": "Not signed in, or the session has expired",
  "items.invalid_id": "Item id must be a UUID",
  "items.invalid_payload": "Invalid ciphertext or nonce",
  "items.forbidden": "No access to that item",
  "items.not_found": "Item not found",
  "shares.invalid_payload": "Invalid ciphertext or nonce",
  "shares.invalid_ttl": "ttlSeconds must be between 60 and 604800",
  "shares.invalid_max_views": "maxViews is out of range",
  "shares.gone": "This link does not exist, has expired, or is out of views",
  "server.rate_limited": "Too many requests, slow down",
  "server.not_found": "No such endpoint",
  "server.error": "Server error",
};

export interface ApiErrorBody {
  code: ApiErrorCode;
  error: string;
  /** Values the client interpolates into the localized message. */
  params?: Record<string, string | number>;
}

export function apiError(
  code: ApiErrorCode,
  params?: Record<string, string | number>,
): ApiErrorBody {
  return params ? { code, error: MESSAGES[code], params } : { code, error: MESSAGES[code] };
}
