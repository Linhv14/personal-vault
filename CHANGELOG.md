# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor
version may change the API or storage format; such releases list the steps in
[Upgrade a deployment](docs/how-to/upgrade.md).

## [Unreleased]

### Added

- Organizations, in Settings → Organization: create one, invite people by email with a role,
  accept invitations, manage roles and removal, create teams whose key is
  wrapped for each member, and a hash-chained audit log. Each organization's
  teams and log live in their own Durable Object.
- Every account gets a key pair the first time the vault opens, the base for
  sharing secrets with teams. The private key is stored only sealed under the
  vault key.
- Unlock with Touch ID or the Mac password on macOS, or Windows Hello on
  Windows (Settings → Security). The server releases the key only for a fresh signature from the
  device's platform authenticator.
- Unlock with a PIN (Settings → Security). The vault key stays sealed under the
  PIN and a key the server releases only for the right PIN; five wrong tries,
  sign-out, a password change or the end of the 30-day session turn it off.
- The login or passkey used last on a site is suggested first. Use is recorded
  in the encrypted item, so the order syncs; Recent in the popup counts it too.
- Passkeys in the sign-in field: when a site asks for a passkey as the page
  loads, the 1PW fill menu on the username field lists the passkeys saved for
  it.
- Preact + Signals UI foundation, with Settings migrated to reactive components
  and shared button, card, icon, toast, locale and session primitives.
- Favorites, user-defined tags and Trash in the popup, with all three states
  kept inside the end-to-end encrypted item payload. Favorites, tags and Trash
  appear as filter chips once they hold an item; trashed items can be restored
  or deleted forever.
- Password health in Settings: weak and reused passwords, and, on request,
  passwords exposed in breaches via Have I Been Pwned's k-anonymity range API.
  Change opens the item in the popup.
- More item types: API keys, SSH keys, bank accounts, documents (passport, ID,
  licence) and software licenses. Every item can hold custom fields, shown or
  hidden.
- A login can list several websites, and can be limited to its exact host.
- Replacing a password keeps the old one: the last 10 are listed under the
  item, from the editor and from autofill's Update.
- Import keeps extra websites, custom fields and password history, and maps
  Bitwarden and 1Password SSH keys, bank accounts, passports, licences and API
  credentials to their own types.
- Item types: notes, cards, addresses, recovery codes and Wi-Fi networks, each
  with its own fields. The list shows logins for the current site first, then
  filters by type; **+** asks which type to create. Items saved earlier stay
  logins.
- Import from Bitwarden (JSON, password-protected JSON with PBKDF2, CSV),
  1Password (1PUX, CSV) and browser CSV files, alongside Proton Pass. The file
  type is recognised automatically; passkeys come over from Bitwarden too.
- Import a file of recovery codes as one item. Pasting codes into a recovery
  codes item splits them whatever the layout: columns, numbering, commas or a
  header.
- Import keeps Proton Pass credit cards and identities as cards and addresses
  instead of skipping them.
- Import reads Proton Pass's PGP-encrypted export after asking for its
  password, decrypting in the browser without an OpenPGP library.
- Import passkeys from a Proton Pass JSON export, including onto logins
  imported earlier without them.
- Clicking into a login field opens the list of matching logins when there is
  one to offer; ↓, Enter and Esc work in the list.
- Passkeys: 1PW can create passkeys on websites and sign in with them, stored
  end-to-end encrypted in the login item and synced like passwords. Turned on
  with autofill; "Use another device" hands any request back to the browser.
- Import from Proton Pass (JSON, CSV or the export archive) from Settings →
  Data, or from an empty vault, with a summary before anything is saved and
  duplicates skipped.
- Settings are grouped into Preferences, Data and Security, with sign-out and
  account deletion kept apart and the privacy policy in the footer.
- `POST /api/items/batch` creates up to 100 items in one request.
- Landing page at `/` and `/vi`, with a downloadable beta of the extension
  built for the server it is served from.

### Changed

- Vault items move from the shared D1 database to one Durable Object per
  account, copied over on the first request after the upgrade. Each account's
  items now sit in their own database, and D1 keeps only accounts, sessions and
  shares.
- The threat model is published at 1pw.online/security. The landing and privacy
  pages no longer link to the source repository, which is now private.
- The import and export page is redesigned: one drop zone with the export
  steps for each app listed under it, a review that counts items by type, and
  export formats side by side.
- The landing page shows the two-pane popup.
- The share screen fits the popup: the item sits in the title bar, expiry and
  view limit are compact rows, and "Create link" stays pinned at the bottom.
- The popup, Settings and the import page render from Preact components
  instead of hand-written DOM code.
- The popup is redesigned as two panes (600 × 430): the item list on the left,
  the selected item on the right with grouped, click-to-copy fields. Types are
  filtered from a dropdown, favorites, tags and trash from the scope switcher,
  app actions sit in the menu, and the list sorts by most recent or by name.
- Export: an encrypted 1PW file (every item type, sealed under a passphrase
  with PBKDF2 and AES-256-GCM, importable back into 1PW) or a CSV of logins for
  other apps. Import and export share one page, opened from **Import / Export**
  in the popup menu, with drag and drop for import files.
- The vault stays unlocked across popup opens and browser restarts by default,
  as Proton Pass does: auto-lock gains "Never" (the new default), and the vault
  key is kept sealed under a per-session key the server holds
  (`GET /api/auth/resume-key`, migration `0005`). Lock now, sign-out, a timed
  auto-lock or a revoked session require the master password again.
- Personal vaults: create, rename, recolour and delete vaults, or move all of a
  vault's items into another, from each vault's ⋯ menu in the popup header, pick an item's vault in the editor, and browse
  one vault or all of them. Vault names stay inside the encrypted data.
  Favorites, tags and the trash move to the side menu.
- Website icons in the popup, fetched through your own server from DuckDuckGo
  or Google (`GET /api/logo`), held in memory only, and switchable off in
  Settings → Preferences. Servers without the endpoint fall back to letters.
- Recovery codes are hidden until revealed, numbered, and can be marked as
  used; the list shows how many are left, and unused codes copy in one go.
- New colour palette across the extension, share page and emails: one teal
  accent on warm off-white in light mode and on teal-tinted ink in dark mode.
  New extension icons to match.
- Removing an item from the editor moves it to Trash instead of deleting it.
- Settings open as a page in a tab, with Preferences, Security, Data and
  Account sections, instead of a screen inside the popup. It is also the
  extension's options page. Shared links are managed there.
- Update the extension on every device before editing a card, address or other
  typed item: older versions edit every item as a login and drop its other
  fields.
- Auto-lock offers 5 minutes, 15 minutes, 1 hour, 4 hours or "when the browser
  closes", instead of a slider.
- Passkey sign-in while 1PW is locked asks to unlock only if the vault holds
  passkeys, and continues by itself once it is unlocked.
- Share screen: shows the item and what the recipient will see; a share
  holds the website, username, password and 2FA secret if any, never the
  note; recipients and the link password sit under "Extra protection";
  recipient emails are entered as validated chips; a summary line states
  expiry and views.
- "Link ready" and "Shared links" are reduced to one summary line per link,
  with copy and revoke as icons.
- The popup keeps one height across the vault screens, so footers stay at the
  bottom; unlock and setup stay as short as their content.
- The share page shows expiry, and the last-view warning, in a banner at the
  top of the card.
- Emails are shorter and say only what the reader must do.
- The email footer is one line: copyright, the site and the privacy policy.
- Share page text cut to what the reader needs: one short line per state,
  no captions under fields, and "password" instead of "passphrase".
- The share page no longer claims to clear the clipboard after 30 seconds; a
  web page cannot do that reliably without a permission prompt.
- The share page lists the website as its first field, a full link with a
  copy button, instead of a small domain chip under the title.
- A share opens once or until it expires, replacing 1, 3 or 10 views. The API
  accepts `maxViews: null` for no view limit.
- A link for several recipients cannot be one-time: the first recipient would
  use up the only view.
- Share lifetimes are 1 hour, 1 day, 7 or 30 days.
- The share page shows the exact time a link stops working instead of an
  approximate countdown, and plural forms replace "(s)" labels.
- Documentation reorganized into tutorials, how-to guides, reference and
  explanation under `docs/`.
- `npm run status` prints the Worker URL.

### Fixed

- The passkey prompt opens as a panel in the top-right corner instead of a
  modal over the page, confirms after saving, and says when the passkey is
  already saved instead of failing silently. Registrations that ask for a
  security key go to the browser, and sites see 1PW as a platform
  authenticator.
- The save-password banner waits until a sign-in succeeds. A wrong password, a
  login page that reloads with the form, or revealing the password no longer
  offers to save.
- Scripts injected into web pages are built in their own scope. Before, the
  autofill and passkey scripts could overwrite each other's functions, and the
  passkey script exposed its variables to the page.
- Vietnamese text uses "mục" and "khoá 2FA" throughout.
- Creating an account right after switching to your own server could ask for
  an email code the server never sends, because the previous server's
  settings were still in use.
- Emails show the 1PW logo, attached inline so nothing is loaded from a
  server when the message is opened.
- Every popup screen scrolls inside one frame with the same padding on all
  sides, so footers no longer touch the bottom edge.
- The search field showed its focus ring around the input only, leaving the
  icon outside.
- The privacy policy said the server never sends email and that Cloudflare
  was the only third party; sign-up codes go out through Resend. The policy
  is rewritten with a data inventory, providers, retention and rights.
- Reloading an opened share link said the link was incomplete, because the
  page removed the key from the address bar after opening it.
- The `shares.invalid_ttl` error message stated a 7-day maximum; the limit is
  30 days.

## [0.2.0] - 2026-10-12

Requires the upgrade steps in
[Upgrade a deployment](docs/how-to/upgrade.md#from-01x-to-020).

### Added

- Autofill, off by default: suggest and fill matching logins, generate a
  password in sign-up forms, offer to save or update after submitting.
- Open registration for a shared server (`--open-registration`), with per-network
  and per-account limits, and account deletion from Settings.
- Email verification at sign-up with a 6-digit code (`--email-from`), sent
  through Resend or Cloudflare Email Sending.
- Custom domain (`--domain`).
- Share links: revoke from Settings → Shared links, restrict to up to ten email
  addresses, 14- and 30-day lifetimes, and a "link password" option.
- `npm run backup` and `npm run package`.
- 1PW name, logo and a single colour token file shared by every page.

### Changed

- Server-side protection of auth hashes and wrapped vault keys under
  `AT_REST_SECRET`, so a database copy alone cannot be used to guess passwords.
- Items are bound to their id with AES-GCM associated data.
- Changing the master password or deleting the account requires the current
  password.
- The extension knows its server from the build; sign-in asks for no host
  permission.
- The share page copies the password without ever displaying it.
- Sign-up keeps its verification step when the popup closes.

### Security

- Rate limits on every anonymous endpoint and on account writes; item and
  session caps per account.
- The clipboard is cleared by the service worker even after the popup closes.
- Strict CSP and anti-framing headers on the share page.

## [0.1.0] - 2026-10-11

### Added

- End-to-end encrypted vault: PBKDF2-SHA256 key derivation, separate auth and
  encryption keys, a wrapped random vault key, AES-256-GCM per item.
- 2FA codes computed in the extension (RFC 6238), from a setup key, an
  `otpauth://` link or a QR code on the current tab.
- Password, passphrase and PIN generator with entropy shown in bits.
- Temporary share links with expiry, view limit and optional passphrase.
- Delta sync across devices; offline reading.
- English and Vietnamese interface.
- One-command deployment to your own Cloudflare account.

[Unreleased]: https://github.com/Linhv14/personal-vault/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Linhv14/personal-vault/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Linhv14/personal-vault/releases/tag/v0.1.0
