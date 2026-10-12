/**
 * English message catalogue — the source of truth.
 *
 * `MessageKey` is derived from this object, and every other locale is typed as
 * `Record<MessageKey, string>`. Adding a key here without translating it is a
 * compile error, so a locale can never silently fall back to English.
 *
 * Placeholders use `{name}` and are substituted by `translator()`.
 */
export const en = {
  // --- Errors thrown by src/core -------------------------------------------
  "error.base32.invalid_character": 'Invalid character in base32 secret: "{char}"',
  "error.totp.empty_secret": "The 2FA secret is empty",
  "error.totp.invalid_uri": "That is not a valid URI",
  "error.totp.not_totp": "Only TOTP is supported, not HOTP",
  "error.totp.missing_secret": "The secret parameter is missing or malformed",
  "error.totp.unsupported_algorithm": "Unsupported algorithm: {algorithm}",
  "error.totp.unrecognized_input": "Not an otpauth:// URI and not a valid base32 secret",
  "error.crypto.unsupported_kdf": "Unsupported key derivation function: {kdf}",
  "error.crypto.empty_password": "The master password is empty",
  "error.crypto.wrong_password": "Incorrect master password",
  "error.crypto.bad_key_length": "The vault key must be 32 bytes",
  "error.share.passphrase_required": "This link needs an extra passphrase",
  "error.share.invalid_key": "The key in the link is not valid",
  "error.share.wrong_passphrase": "Incorrect passphrase",
  "error.share.undecryptable": "Could not decrypt — the link may have been truncated",
  "error.generator.no_character_set": "Pick at least one character set",
  "error.generator.length_too_short": "Minimum length is {min} so each set gets one character",
  "error.generator.length_too_long": "Maximum length is {max}",
  "error.generator.too_few_words": "A passphrase needs at least {min} words",
  "error.generator.too_many_words": "At most {max} words",
  "error.generator.wordlist_too_small": "The word list is too short",
  "error.generator.pin_length_out_of_range": "PIN length must be between {min} and {max}",
  "error.generator.invalid_max": "max must be a positive integer",

  // --- Errors surfaced by the API client -----------------------------------
  "error.api.no_server": "No server address configured",
  "error.api.not_signed_in": "Not signed in",
  "error.api.offline": "Cannot reach the server. Data already saved is still readable.",
  "error.api.session_expired": "Your session expired — unlock the vault again",
  "error.api.generic": "Error {status}",

  // --- Error codes returned by the Worker ----------------------------------
  "error.auth.bad_registration_token": "That registration token is not correct",
  "error.auth.invalid_body": "The request was malformed",
  "error.auth.invalid_email": "That email address is not valid",
  "error.auth.invalid_kdf": "Invalid key derivation settings",
  "error.auth.invalid_auth_key": "Invalid authentication key",
  "error.auth.invalid_wrapped_key": "Invalid wrapped vault key",
  "error.auth.email_taken": "That email is already registered on this server",
  "error.auth.invalid_credentials": "Incorrect email or master password",
  "error.auth.rate_limited": "Too many failed attempts. Try again in {seconds} seconds.",
  "error.auth.unauthorized": "Not signed in, or the session has expired",
  "error.items.invalid_id": "Invalid item id",
  "error.items.invalid_payload": "Invalid encrypted payload",
  "error.items.forbidden": "You do not have access to that item",
  "error.items.not_found": "Item not found",
  "error.shares.invalid_payload": "Invalid encrypted payload",
  "error.shares.invalid_ttl": "The expiry is out of the allowed range",
  "error.shares.invalid_max_views": "The view limit is out of the allowed range",
  "error.shares.gone": "This link does not exist, has expired, or is out of views",
  "error.server.rate_limited": "Too many requests. Wait a minute and try again.",
  "error.server.not_found": "No such endpoint",
  "error.server.error": "Server error",

  // --- Shared --------------------------------------------------------------
  "common.copy": "Copy",
  "common.copied": "Copied {what} — the clipboard clears in 30 seconds",
  "common.show": "Show",
  "common.hide": "Hide",
  "common.back": "← Back",
  "common.username": "Username",
  "common.password": "Password",
  "common.totp": "2FA code",
  "common.url": "Website",
  "common.note": "Note",
  "common.error": "Error",

  "strength.very_weak": "very weak",
  "strength.weak": "weak",
  "strength.fair": "fair",
  "strength.strong": "strong",
  "strength.very_strong": "very strong",

  // --- Setup ---------------------------------------------------------------
  "setup.title": "Set up",
  "setup.mode_create": "New vault",
  "setup.mode_signin": "Sign in",
  "setup.hint_signin":
    "Setting up another machine. You need the same server address, email and master password — the registration token is only for creating a vault.",
  "setup.hint_create":
    "One-time setup. Your master password is never stored anywhere and cannot be recovered — if you forget it, the vault is gone.",
  "setup.server": "Server address",
  "setup.email": "Email",
  "setup.registration_token": "Registration token",
  "setup.master_password": "Master password",
  "setup.confirm": "Confirm",
  "setup.create": "Create vault",
  "setup.sign_in": "Sign in",
  "setup.password_mismatch": "The two master passwords do not match",
  "setup.permission_denied": "Access to the server must be granted to continue",
  "setup.working": "Working… (deriving the key takes a few seconds)",

  // --- Unlock --------------------------------------------------------------
  "unlock.title": "Unlock vault",
  "unlock.submit": "Unlock",
  "unlock.working": "Unlocking…",
  "unlock.reset": "Use a different server or email",
  "unlock.reset_confirm":
    "Erase the configuration and data cached on this machine? The vault on the server is untouched.",
  "unlock.offline": "No connection — opening the copy stored on this machine",

  // --- Item list -----------------------------------------------------------
  "list.search": "Search…",
  "list.add": "Add item",
  "list.generator": "Generate a password",
  "list.settings": "Settings",
  "list.lock_now": "Lock now",
  "list.matching_for": "For {domain}",
  "list.all": "All",
  "list.results": "Results ({count})",
  "list.empty": "No items yet. Press + to add one.",
  "list.syncing": "Syncing…",
  "list.synced": "Synced",
  "list.synced_changes": "Synced {count} changes",
  "list.offline": "Offline — showing the saved copy",
  "list.sync_error": "Sync failed",
  "list.clock_skew":
    "This machine's clock is {direction} by {seconds} seconds relative to the server. 2FA codes are still correct because the offset is applied, but you should fix the system clock.",
  "list.clock_behind": "behind",
  "list.clock_ahead": "ahead",

  // --- Add / edit ----------------------------------------------------------
  "edit.add_title": "Add item",
  "edit.edit_title": "Edit item",
  "edit.name": "Name",
  "edit.totp_secret": "2FA secret (TOTP)",
  "edit.totp_placeholder": "JBSWY3DPEHPK3PXP or otpauth://…",
  "edit.save": "Save",
  "edit.delete": "Delete this item",
  "edit.delete_confirm": 'Delete "{title}"? This cannot be undone.',
  "edit.reveal": "Show/hide",
  "edit.regenerate": "Generate a new password",
  "edit.scan": "Scan a QR code on the open tab",
  "edit.scan_unsupported":
    'This Chrome build has no built-in QR decoder. Use the "can\'t scan the QR code?" link on the website to get the base32 string, then paste it here.',
  "edit.scanning": "Capturing the tab and looking for a QR code…",
  "edit.scan_not_qr": "Found a QR code, but it is not a 2FA code.",
  "edit.scan_none": "No QR code in the visible area. Scroll until it is fully visible and retry.",
  "edit.scan_capture_failed": "Could not capture the tab: {reason}",
  "edit.scan_ok": "Read the QR code{issuer}. Sample code: {code}",
  "edit.scan_ok_issuer": " for {issuer}",
  "edit.totp_parse_failed": "Could not read that 2FA secret: {reason}",
  "edit.saved": "Saved",
  "edit.added": "Item added",
  "edit.deleted": "Deleted",

  // --- Generator -----------------------------------------------------------
  "gen.title": "Generate a password",
  "gen.mode_random": "Random",
  "gen.mode_passphrase": "Passphrase",
  "gen.mode_pin": "PIN",
  "gen.length": "Length",
  "gen.words": "Words",
  "gen.pin_digits": "Digits",
  "gen.uppercase": "Uppercase",
  "gen.digits": "Digits",
  "gen.symbols": "Symbols",
  "gen.exclude_ambiguous": "Drop look-alike characters (0/O, 1/l)",
  "gen.capitalize": "Capitalize words",
  "gen.append_digit": "Append a digit",
  "gen.regenerate": "Generate again",
  "gen.entropy": "{bits} bits — {strength}",

  // --- Sharing -------------------------------------------------------------
  "share.title": "Share",
  "share.sharing": 'Sharing "{title}"',
  "share.expires_in": "Expires in",
  "share.ttl_1h": "1 hour",
  "share.ttl_24h": "24 hours",
  "share.ttl_7d": "7 days",
  "share.max_views": "Maximum views",
  "share.views_1": "once",
  "share.views_3": "3 times",
  "share.views_10": "10 times",
  "share.include_totp": "Include a self-refreshing 2FA code",
  "share.passphrase": "Extra passphrase (optional)",
  "share.passphrase_placeholder": "Tell them over a separate channel",
  "share.channel_warning":
    "Whoever carries the link — a chat app, email — can read all of it. An extra passphrase means one compromised channel is not enough to open it.",
  "share.create": "Create link",
  "share.link": "Link",
  "share.copy_link": "Copy link",
  "share.result_note": "Viewable {views} time(s), expires {expiry}.",
  "share.result_note_passphrase":
    " Do not send the passphrase through the same channel as the link.",

  // --- Settings ------------------------------------------------------------
  "settings.title": "Settings",
  "settings.auto_lock": "Lock automatically after",
  "settings.minutes": "{count} min",
  "settings.language": "Language",
  "settings.language_auto": "Match the browser",
  "settings.info": "{email} · {count} items · {sync}",
  "settings.synced_at": "synced at {time}",
  "settings.never_synced": "never synced",
  "settings.change_password": "Change master password",
  "settings.current_password": "Current master password",
  "settings.new_password": "New master password",
  "settings.change_hint": "Every other device must sign in again. No item is re-encrypted.",
  "settings.change_submit": "Change",
  "settings.changed": "Master password changed. Unlock the vault again with the new one.",
  "settings.wrong_current": "That is not the current master password",
  "settings.need_relock": "Lock and unlock the vault before changing the master password",
  "settings.logout": "Sign out and erase the data on this machine",
  "settings.logout_confirm":
    "Sign out and erase all data on this machine? The vault on the server is untouched.",

  // --- Share recipient page ------------------------------------------------
  "view.loading": "Opening…",
  "view.loading_hint": "Decryption happens on your machine.",
  "view.passphrase_title": "Passphrase required",
  "view.passphrase_hint":
    "The sender set an extra passphrase and shared it with you another way. Nothing is downloaded until you enter it — each download costs one view.",
  "view.passphrase_placeholder": "Passphrase",
  "view.open": "Open",
  "view.failed_title": "Could not open",
  "view.default_title": "Shared details",
  "view.missing_key":
    "The link is missing its decryption key. It was probably truncated in transit — ask the sender to resend it whole.",
  "view.expires_hours": "expires in ~{count}h",
  "view.expires_minutes": "expires in ~{count} min",
  "view.views_left":
    "{count} view(s) left on this link. Save what you need before closing the tab.",
  "view.last_view":
    "This is the last view — reloading will not work. Save what you need right now.",
  "view.totp_label": "2FA code{issuer}",
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<MessageKey, string>;
