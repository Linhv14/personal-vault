# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor
version may change the API or storage format; such releases list the steps in
[Upgrade a deployment](docs/how-to/upgrade.md).

## [Unreleased]

### Changed

- Share screen: shows the item and what the recipient will see; a share
  holds the website, username, password and 2FA secret if any, never the
  note; recipients and the link password sit under "Extra protection";
  recipient emails are entered as validated chips; a summary line states
  expiry and views.
- "Link ready" and "Shared links" are reduced to one summary line per link,
  with copy and revoke as icons.
- The popup has a fixed height, so footers stay at the bottom of every screen.
- The share page shows expiry, and the last-view warning, in a banner at the
  top of the card.
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
