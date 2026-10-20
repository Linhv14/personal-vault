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
  | "auth.registration_limit"
  | "auth.invalid_code"
  | "auth.code_expired"
  | "auth.code_cooldown"
  | "auth.email_failed"
  | "auth.invalid_credentials"
  | "auth.invalid_recovery_code"
  | "auth.rate_limited"
  | "auth.unauthorized"
  | "auth.pin_wrong"
  | "auth.pin_off"
  | "auth.biometric_off"
  | "auth.biometric_failed"
  | "auth.session_not_found"
  | "account.identity_exists"
  | "orgs.not_found"
  | "orgs.forbidden"
  | "orgs.invalid_name"
  | "orgs.invalid_invite"
  | "orgs.invalid_role"
  | "orgs.invalid_team"
  | "orgs.already_member"
  | "orgs.limit_reached"
  | "orgs.not_in_team"
  | "orgs.seat_limit"
  | "orgs.domain_not_allowed"
  | "orgs.invalid_domains"
  | "orgs.invite_domain_blocked"
  | "orgs.transfer_needs_admin"
  | "orgs.transfer_needs_key"
  | "orgs.team_limit"
  | "orgs.stale_team_key"
  | "orgs.team_changed"
  | "orgs.invalid_project"
  | "orgs.invalid_secret"
  | "orgs.project_limit"
  | "orgs.secret_limit"
  | "orgs.rekey_required"
  | "orgs.invalid_link"
  | "orgs.protected_environment"
  | "orgs.read_only"
  | "orgs.link_limit"
  | "orgs.invalid_item"
  | "orgs.item_limit"
  | "orgs.vault_full"
  | "ci.unauthorized"
  | "ci.forbidden"
  | "items.invalid_id"
  | "items.invalid_payload"
  | "items.forbidden"
  | "items.not_found"
  | "items.quota_exceeded"
  | "items.conflict"
  | "shares.invalid_payload"
  | "shares.invalid_ttl"
  | "shares.invalid_max_views"
  | "shares.gone"
  | "shares.invalid_recipients"
  | "shares.email_unavailable"
  | "shares.email_required"
  | "shares.invalid_code"
  | "shares.code_expired"
  | "server.rate_limited"
  | "server.read_only"
  | "server.import_conflict"
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
  "auth.registration_limit": "Too many new accounts from this network today",
  "auth.invalid_code": "That verification code is not correct",
  "auth.code_expired": "The verification code expired; request a new one",
  "auth.code_cooldown": "Wait a minute before requesting another code",
  "auth.email_failed": "The verification email could not be sent",
  "auth.invalid_credentials": "Incorrect email or master password",
  "auth.invalid_recovery_code": "Incorrect email or recovery code",
  "auth.rate_limited": "Too many attempts, try again later",
  "auth.unauthorized": "Not signed in, or the session has expired",
  "auth.pin_wrong": "Wrong PIN",
  "auth.pin_off": "PIN unlock is off for this session",
  "auth.biometric_off": "Biometric unlock is off for this session",
  "auth.biometric_failed": "The biometric check did not pass",
  "auth.session_not_found": "That session does not exist or was already signed out",
  "account.identity_exists": "This account already has a key pair",
  "orgs.not_found": "Organization, team or member not found",
  "orgs.forbidden": "Your role does not allow this",
  "orgs.invalid_name": "Use 1 to 80 characters",
  "orgs.invalid_invite": "Enter a valid email address and role",
  "orgs.invalid_role": "That role cannot be set",
  "orgs.invalid_team": "Invalid team name or key",
  "orgs.already_member": "That person is already a member",
  "orgs.limit_reached": "This organization has reached its limit",
  "orgs.not_in_team": "Only members of the team can add people to it",
  "orgs.seat_limit": "This plan has no free seats; pending invitations count",
  "orgs.domain_not_allowed": "This organization only accepts addresses on its allowed domains",
  "orgs.invalid_domains": "Allowed domains must be up to 10 valid domain names",
  "orgs.invite_domain_blocked": "This organization no longer accepts this email domain",
  "orgs.transfer_needs_admin": "Ownership can only go to an admin; make them an admin first",
  "orgs.transfer_needs_key": "That member has not finished setting up their account yet",
  "orgs.team_limit": "This plan allows no more teams",
  "orgs.stale_team_key": "The team key changed; reload and try again",
  "orgs.team_changed": "The team's members changed; reload and try again",
  "orgs.invalid_project": "Invalid project id or content",
  "orgs.invalid_secret": "Invalid secret id, environment or content",
  "orgs.project_limit": "This plan allows no more projects",
  "orgs.invalid_item": "Invalid shared item id or content",
  "orgs.item_limit": "This shared vault is full",
  "orgs.vault_full": "This shared vault has reached its storage limit",
  "orgs.secret_limit": "This project has reached its secret limit",
  "orgs.invalid_link": "Invalid repository, branch, environment or key",
  "orgs.protected_environment": "Only admins can change this environment",
  "orgs.read_only": "You can view this team but not change it",
  "orgs.link_limit": "This project has reached its repository limit",
  "ci.unauthorized": "A valid GitHub Actions OIDC token is required",
  "ci.forbidden": "This repository, branch or environment is not linked to these secrets",
  "orgs.rekey_required": "Someone left this team; create a new team key before changing secrets",
  "items.invalid_id": "Item id must be a UUID",
  "items.invalid_payload": "Invalid ciphertext or nonce",
  "items.forbidden": "No access to that item",
  "items.not_found": "Item not found",
  "items.quota_exceeded": "This vault has reached its item limit",
  "items.conflict": "The item changed on the server since it was read",
  "shares.invalid_payload": "Invalid ciphertext or nonce",
  "shares.invalid_ttl": "ttlSeconds must be between 60 and 2592000 (30 days)",
  "shares.invalid_max_views": "maxViews is out of range",
  "shares.gone": "This link does not exist, has expired, or is out of views",
  "shares.invalid_recipients": "Recipients must be up to 10 valid email addresses",
  "shares.email_unavailable":
    "This server cannot send email, so links cannot be limited to addresses",
  "shares.email_required": "This link only opens for specific email addresses",
  "shares.invalid_code": "That code is not correct",
  "shares.code_expired": "The code expired; request a new one",
  "server.rate_limited": "Too many requests, slow down",
  "server.import_conflict": "The target already holds data for one of these stores",
  "server.read_only": "The server is moving and accepts no changes for a few minutes",
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
