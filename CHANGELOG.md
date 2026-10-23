# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor
version may change the API or storage format; such releases list the steps in
[Upgrade a deployment](docs/how-to/upgrade.md).

## [Unreleased]

### Added

- `7key login --sso` signs in through the organization's identity provider:
  the CLI opens the browser, receives the result on a one-time
  `127.0.0.1` port (RFC 8252), then asks for the master password. Password
  sign-in under **Require SSO** now points there.
- `7key --version`.
- `7key mcp` serves 7key to AI agents over the Model Context Protocol (stdio):
  `check_setup`, `list_secrets` (names and allowed hosts only) and
  `run_with_secrets`, which runs a command with placeholders through the same
  proxy as `7key agent`. The user approves the secrets in the client's
  permission prompt, or with `--yes` for clients that cannot ask, and the login
  is set aside while the server runs.

### Changed

- The console's suggestion of AI agent hosts takes one line, with the list
  behind **Show**, so it no longer pushes the secrets table down.

## [0.5.0] - 2026-10-23

Upgrade with `npm run upgrade`. Migrations `0013` to `0017` only add tables
and columns. See [Upgrade a deployment](docs/how-to/upgrade.md#from-04x-to-050).

### Security

- Sign-in, recovery, email and share codes are throttled per network, and
  each attempt is counted atomically, so parallel guesses cannot exceed the
  limits. Sign-in no longer reveals whether an address is registered.
- The server enforces the 600,000-iteration KDF floor, and the extension
  re-derives an older vault key at that strength after sign-in.
- Master passwords need 12 characters and are checked against known breaches
  (k-anonymity, only a hash prefix leaves the device).
- Lookalike domains of saved logins are flagged before autofill, and card
  fills are pinned to the registered payment frame.
- `7key agent` scrubs base64, hex and percent-encoded forms of a secret, and
  the CLI refuses an unencrypted session file unless explicitly asked.

### Changed

- Privacy policy links on the share page, `/security`, `/api-docs`, email
  footers and the extension's Account page appear only when the operator sets
  `PRIVACY_URL` (`--privacy-url`), and point there instead of `/privacy` on the
  server.
- `/` shows a short built-in home page linking to the web app, the extension,
  `/security` and `/api-docs`.
- 7key is now licensed under the GNU AGPL-3.0 instead of the MIT License; releases
  before this one stay under MIT. Future enterprise-only modules may live in a
  `commercial/` directory under the source-available 7key Commercial License. See
  `LICENSE_FAQ.md`, `TRADEMARKS.md` and the contributor agreement in `CLA.md`.

### Fixed

- With Touch ID offered, an unlock error no longer squeezes the master password
  field: it shows on its own line below.
- Random US phone numbers use real area codes instead of 555, and Vietnamese
  ones use real mobile prefixes, so checkout forms accept them.
- The card expiry field only takes MM/YY.
- Share links now carry an item's custom fields, such as an account ID, and
  the share screen lets you pick each part to include; the note stays out
  unless picked.

### Added

- **Single sign-on** for organizations (enterprise plan, or a `LICENSE_KEY` on
  a self-hosted server): OpenID Connect with Google Workspace, Entra ID, Okta
  and others, DNS-verified domains, **Require SSO** and **Single organization**
  policies. The identity provider is trusted only for addresses on verified
  domains; members on other domains link their account once, after
  re-entering their master password. In the extension, the provider step runs
  in the background and the popup reopens on the master password. See
  [Set up single sign-on](docs/how-to/set-up-sso.md).
- **Two-factor authentication for the account:** turn it on with a QR code in
  Settings → Security; the extension, the web app and the CLI ask for the code
  or a backup code after the master password.
- **Signed-in devices** in Settings, with sign-out per device or for all
  others.
- Optional Turnstile check on sign-up, recovery and share codes
  (`--turnstile-site-key`).
- Autofill: save prompts show and let you edit the username and password,
  warn when the password is reused, can be turned off per site, and come back
  from the popup for five minutes after being dismissed. Typed cards,
  addresses and lone phone numbers can be saved too.
- `npm run upgrade` backs up the database, pulls the latest release,
  reinstalls dependencies and deploys with the saved options, refusing to run
  over local changes. `npm run deploy` ends with the `7key login --server`
  line for the CLI.
- Card autofill works in the card fields that Shopify, Stripe, Braintree, Adyen
  and other payment providers put in their own frames.
- Random details in the autofill menu can be made in either US or Vietnam
  format.

- Email aliases: on sign-up forms, the email field offers an address just for
  that site, such as `you+shopify@gmail.com`, for Gmail, Outlook, iCloud,
  Fastmail, Proton and Zoho addresses.
- Sign-up and contact forms with a name, email or phone now offer your saved
  address items, or made-up details, even when they ask for no street address.
- **Settings → Trash** lists deleted items with when each was deleted and how
  long until it is purged. Restore or delete forever one item, a selection, or
  empty the whole trash; search filters by title.
- Items stay in the trash for 30 days, then the extension deletes them forever
  after the next unlock and sync. Items in team vaults are not purged
  automatically.
- Card autofill: payment forms get the 7key menu with your cards shown by brand
  and last four digits. Picking one fills the name, number, security code and
  expiry, including separate month and year fields and combined `MM/YY`
  fields. Fields are recognised from `autocomplete` and from English and
  Vietnamese labels.
- Address autofill: address forms fill from address items, matching country,
  state and province selects by code or name. Address items gain a
  **Ward or commune** field.
- Random addresses: the generator's new **Address** mode makes a realistic US
  or Vietnamese name, address and phone number, with an optional email, to copy
  field by field or save as an address item. Address forms also offer
  **Random address** in the autofill menu.
- Secret history: the console keeps the last five values of each secret, with
  who changed it and when; **History** on a secret's row shows them and
  restores one. Re-keying a team re-encrypts the history too.
- Invitations can put people straight into teams with the access chosen in
  the invite; once they accept, the team shows them waiting and one click
  grants them the team key.
- Adding people to a team takes many at once: search, add every match, or paste
  a list of emails; the access chosen applies to everyone added.
- View-only team members: when adding someone to a team, or later from the
  team's member list, an admin chooses **Can edit** or **Can view**. People who
  can view read and run with the team's secrets but cannot change them, and the
  extension shows the team vault as view only.
- Protected environments: **Protect** an environment such as production from
  the project's menu, and only admins can change its secrets.
- `7key read <reference>` prints one secret, by name in the linked project or
  as `7key://<project>/<env>/<NAME>`.
- `7key inject` fills `{{ 7key:NAME }}` and `{{ 7key://<project>/<env>/<NAME> }}`
  in a template from a file or standard input, fetching each environment once.
  It writes nothing when a reference is unknown, and `-o` creates a file only
  you can read.
- Browser tests: `npm run test:browser` loads the built extension in Chromium
  with Playwright and drives sign-up, lock and unlock, autofill, the console
  and the recovery code against a local Worker on port 8789. See
  [Run the browser tests](docs/how-to/run-browser-tests.md).

## [0.4.1] - 2026-10-19

### Changed

- The console shows a secret's AI agent hosts under its name and suggests
  them from the key's name or prefix (Stripe, OpenAI, Anthropic, GitHub,
  Shopify and about 35 more); **Apply suggested hosts** sets them for every
  environment at once.

### Fixed

- A login saved from a site is filed under that site's host, such as
  `gemini.google.com` or `mail.google.com`, instead of the root domain, so
  products of one company no longer share or overwrite one entry. Sign-in
  hosts such as `accounts.google.com` still file under `google.com`.

## [0.4.0] - 2026-10-19

### Security

- Team vaults: captured passwords and new passkeys go only into personal items,
  so a teammate cannot plant a matching login to catch them; team suggestions
  name their vault; duplicated item ids can no longer shadow or delete a
  personal item; the popup refuses a team key older than one it has seen;
  re-keying deletes items that no longer open instead of getting stuck; a team
  vault is capped at 5 MB, and the extension asks for `unlimitedStorage`.
- `7key agent`: secrets are swapped into request headers only, never the URL
  or body; compressed responses are decompressed before values are hidden and
  unknown encodings are refused; values split across slow responses stay
  hidden; the proxy needs a per-session password; wildcards on shared suffixes
  and secrets under 8 characters are refused; Ctrl-C no longer kills 7key
  before it cleans up and signs out.

### Added

- Recovery code: create one under Settings → Security, then use **Forgot
  master password?** in the popup to set a new password with it and a code
  emailed to you. The code used is replaced and every device is signed out.
  Migrations `0011` and `0012`.
- CLI `7key login`, `7key link`, and `7key run`, `7key dotenv` and
  `7key secrets` on your own computer. The session stays in the system
  keychain; `.7key.json` names the project for a folder. `--project`, `--org`
  and `--env` take an id, a handle (`trust1-portal`) or a name, and the
  console's project menu copies the CLI command or the project id.
- `7key agent` uses the login and the folder's link, and takes the login out
  of the keychain while the agent runs.
- Account emails (sign-up codes, recovery) are sent through Resend on
  7key.online.

- Turning on autofill also turns off the browser's own offer to save and fill
  passwords, in the same permission prompt (the optional `privacy`
  permission), in Chrome, Edge, Brave, Opera, Vivaldi and other Chromium
  browsers; turning autofill off gives it back. When a policy or another
  extension controls the setting, 7key says so and opens the browser's
  password settings instead.
- Autofill fills 2FA codes: code fields get the 7key menu with the site's
  logins that have a code, and one-digit boxes are filled digit by digit.
- Autofill offers to save 2FA while you set it up: it finds the `otpauth://`
  link, setup key or QR code on the page, adds the secret to the matching
  personal login (or creates one), and fills the confirmation code.
- On sign-up forms the **Use a strong password** menu opens as soon as the
  password field gets focus, and sign-up forms are recognised by their button
  text too.
- The CLI installs from npm (`npm install -g @7key/cli`, `npx @7key/cli`) and
  Homebrew (`brew install linhv14/7key/sevenkey`).
  `npm run publish:cli -- <version>` publishes both, and `--tap-only` updates
  the Homebrew tap for a version already on npm.
- `7key agent --project <name> --env <name> -- <command>` runs a command, such
  as Claude Code, with placeholders in place of secrets. A proxy on
  `127.0.0.1`, trusted through a per-session certificate authority, swaps in
  the real value only on requests to the hosts allowed for that secret, hides
  values echoed back in responses, and tunnels every other host untouched.
  Secrets get **AI agent hosts** in the console, with an **Agent** badge, and
  use is logged as `secret.injected`. See
  [Use secrets with AI agents](docs/how-to/use-secrets-with-ai-agents.md).
- Team vaults: every team in an organization has a shared vault for logins,
  2FA codes, passkeys and other items, listed in the popup under the
  organization's name. Members read, edit, autofill and move items in and out
  of it; **Share with a team** moves a whole personal vault. Items are sealed
  under the team key, re-encrypted when someone leaves, and cached for offline
  use. New endpoints `GET /api/vaults` and
  `PUT|DELETE /api/orgs/:id/teams/:teamId/items/:itemId`; the re-key request
  carries `items`.
- New landing page: product video (English and Vietnamese, about 50 seconds,
  recorded from the real UI on a demo workspace, with zoomed close-ups, a
  zero-knowledge and team key diagram, a GitHub Actions run and an AI agents
  preview), fresh screenshots, features, use cases, team and CI
  sections, pricing and FAQ. Canonical and hreflang links, Open Graph and
  Twitter cards with 1200×630 images, JSON-LD for the app and the FAQ, and
  generated `robots.txt` and `sitemap.xml`. The header no longer links to the
  dashboard.
- `tools/demo-video/` records the landing video, posters and Open Graph
  images from a local Worker; see
  [Record the demo video](docs/how-to/record-the-demo-video.md).
- `/api/migration/export` and `/api/migration/import` (only with the
  `MIGRATION_TOKEN` secret) copy every Durable Object store between
  deployments, and `READ_ONLY=1` refuses writes while moving.
- `ALIAS_ORIGINS` lets CI tokens issued for an old address keep working.

### Changed

- Passkey registrations that ask for a security key (`cross-platform`), as
  npm's do, now show the 7key dialog too; **Use another device** still hands
  them to a physical key.
- New brand: the logo is a seven-segment dial that turns one notch at a time
  on the unlock screen and the landing page (still elsewhere, and still for
  anyone who asks for reduced motion), and the accent colour is orange
  (`#FF6A3D` on dark, `#C2410C` on light) with warm neutral greys. Icons,
  favicon, emails, Open Graph images and the demo video follow.
- The site and the console no longer mention pricing or plans: the pricing
  section, "free" wording and the price in the structured data are gone, and
  organization settings show usage and limits only. Docs no longer compare
  7key with other password managers outside the import guide.
- The hosted service moved to `https://7key.online`. Accounts, vaults,
  organizations and CI secrets were copied from the previous address unchanged, so
  the same master password and repository keys keep working. The CLI and the
  Action default to the new address; `ALIAS_ORIGINS` keeps CI tokens issued
  for the previous address valid.
- The hosted service is the default everywhere: sign-in no longer shows the
  server field, even when the browser remembers another server, and Settings
  hides the server row for the default. **Use your own server** still opens
  the field, prefilled with the remembered server. Builds without a local
  deployment take the server from `deploy/production.json`.
- The product is now **7key**, independent of Trust1: name, wordmark ("7key"
  with the 7 in the accent colour), emails, site and docs. The CLI is `7key`
  (`7key.mjs`), its variables are `SEVENKEY_KEY`, `SEVENKEY_LINK` and
  `SEVENKEY_SERVER`, and the Action moved to `Linhv14/7key-action` (the old
  name redirects). Downloads and exports are named `7key-…`. Stored data, keys
  and storage names are unchanged.

- The GitHub Action and the CLI are published from the public repository
  `Linhv14/trust1-vault-action` (`uses: Linhv14/trust1-vault-action@v1`, CLI as
  a release asset), so any repository can use them. `npm run publish:action`
  releases a new version. The console's workflow snippet points there.

### Fixed

- Long recovery codes, such as npm's 64-character ones, no longer overflow or
  wrap: each stays on one line with an ellipsis, long sets list one per row,
  and a click still copies the whole code. Hidden codes show a fixed run of
  dots, without the dashes or length of the real code.
- The type filter keeps its count on the same line, and the sort menu is an
  icon, so labels such as "Recovery codes (4)" fit.
- The popup no longer widens on the share screen: the hidden choices in the
  expiry and views selectors overflowed to the right, so Chrome grew the popup
  while its layout stayed 600 pixels wide.

## [0.3.0] - 2026-10-16

Organizations, projects and CI secrets; the product is now Trust1 Vault. See
[Upgrade a deployment](docs/how-to/upgrade.md#from-02x-to-030).

### Security

- Every page sends `Strict-Transport-Security`; API responses send
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`.
- The extension manifest carries a fixed `key`, so unpacked installs keep one
  extension ID (and one origin for device unlock) wherever they are loaded
  from. `npm run package` leaves it out of the Chrome Web Store upload.

### Added

- Organization email domains (Settings, owner only): when set, invitations,
  account creation from an invitation and accepting one only work for
  addresses on those domains. Members already outside keep their access and
  are marked in the member list; the invite dialog shows the allowed domains.
  Needs migration `0010_org_domains.sql`.

- Console and dashboard: buttons show a spinner while their action runs and
  ignore repeated clicks, dialogs keep their submit busy until the work is done,
  a thin progress bar marks background refreshes, pages load behind skeletons,
  and toasts stack with success and error variants. Editing or deleting a secret
  updates the row at once; withdrawing an invitation or removing a member drops
  the row as soon as the server confirms.

- Invitations: the email shows the organization, who invited, the role and the
  expiry, with an "Accept invitation" button. Someone without an account
  creates one on the page the link opens, with the invited address filled in,
  and lands in the organization; no extension needed, and no registration code
  on token-only servers. Someone with an account signs in and accepts. Pending
  invitations can be resent or their link copied, and when no email provider is
  configured the console shows the link to share by hand.
- Emails share one layout and component set (`src/worker/email/`).

- GitHub Actions: link a repository to one environment of a project (console,
  project, CI tab) and read it from a workflow with the `action/` step or the
  `1pw` CLI (`run`, `env`, `dotenv`). The workflow proves its repository and
  branch with GitHub's OIDC token; the server returns ciphertext that only the
  repository key, kept as a GitHub secret, opens. Reads are logged with the
  repository and ref, and unlinking stops them at once.
- Each environment has its own key derived from the project key, so a repository
  gets one environment and nothing else. Existing secrets are re-sealed the first
  time the project is opened.

- Variables and secrets: each entry has a type, chosen when adding, importing or
  editing. Variables show their value; secrets stay masked, and revealing,
  copying or exporting one is recorded in the activity log.

- Environments can be added, renamed and deleted from a project page.

- Projects and secrets (Organization → Projects, in the extension and the
  dashboard): a team's projects hold secrets per environment (Development,
  Staging, Production), encrypted end to end with a project key sealed under the
  team key. Add, edit, reveal, copy and delete secrets, import a .env file and
  copy an environment as .env. Every read and write is in the activity log,
  without names or values.
- Re-keying a team now also rotates its project keys and re-encrypts every
  secret; writes are refused until a team that lost a member has a new key.
- Adding someone to a team shows their key fingerprint to compare first.

- Web dashboard at `/app`: sign in with the master password to manage
  organizations (members, invitations, teams, re-keying, activity) outside the
  extension. Keys stay in the page's memory and it signs out after 15 minutes
  without activity. Linked from Settings → Organization and the landing page;
  invitation emails point to it.

- Team re-keying: after someone leaves a team, an admin in the team creates a
  new key, wrapped for each remaining member in one step. Team keys carry a
  generation; adding a member with an older generation's key is refused.
- Ownership transfer: the owner picks Owner in a member's role menu and becomes
  an admin.
- Plan limits: the free plan has 5 seats (members plus pending invitations) and
  3 teams; the organization header shows the plan and seats used.

- Organizations, in Settings → Organization, reachable from a Teams button next
  to the add button and from the popup menu, and announced in the popup when an
  invitation is waiting: create one, invite people by email with a role,
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

- Device unlock names the platform's own method: Touch ID or Mac password,
  Windows Hello, ChromeOS PIN or fingerprint, or screen lock elsewhere. When it
  isn't set up, Settings says where to turn it on for that system.
- The new owner gets an email after a transfer, with a link to the
  organization's settings, when an email provider is configured.
- Transferring ownership is stricter: the owner re-enters their master password
  (checked by the server), the new owner must already be an admin with a
  finished account and, when email domains are set, an allowed address. The
  dialog lists what changes for both people. `POST /api/orgs/:id/owner` now
  takes `authKey` and answers `400 orgs.transfer_needs_admin`,
  `400 orgs.transfer_needs_key` or `403 auth.invalid_credentials`.

- Console layout: empty states are left-aligned rows with their action on the
  right instead of centered dashed boxes; settings panels put their action in
  the panel header; the invitation page is an ordinary page with a details
  table; tables, toolbars and panel titles share one 18px gutter; page actions
  line up with the title; activity columns have fixed widths and show invited
  addresses instead of "Former member".
- Consistent display rules: tables name the entity column "Name" and the time
  column "Updated"; roles always show as a badge; absolute dates always carry
  the year; a project's secret count is the same number in the list, the
  header and the sum of its environment tabs.
- Scope by role: members no longer see plan usage, seat usage or email domains;
  Settings lists the organizations you belong to, with creating a new one next
  to that list. The roles table is in `docs/explanation/teams.md`.
- The key verification dialog shows the key in large groups with one Done
  button and says why keys are compared person to person.
- Extension popup follows the same rules: only "+" is a primary button in the
  top bar (the vault and Organizations buttons are neutral, and the latter is
  named like the drawer entry), list group labels are sentence case, empty
  states are left-aligned, the add menu no longer wraps labels, updated and
  created dates sit on their own lines, and the toast matches the console.
- Row actions line up on one axis at one height; destructive actions are marked
  as such (withdraw, remove, delete and unlink turn red on hover or are red
  text), and removing duplicate secrets now asks for confirmation.
- Emails: one left-aligned layout with the logo inside the message, a smaller
  button and a plain fallback link. The invitation states who invited you, the
  role and the expiry in two sentences instead of a table and numbered steps.

- `GET /api/orgs/:id` includes the caller's projects per team, and the console
  fetches it in parallel with the organization list and the identity check. A
  page load or a refresh after an action takes one round trip instead of three,
  and the success message no longer waits for that refresh.

- Renamed to Trust1 Vault: extension, popup, console, dashboard, emails, site and
  docs. The CLI is `trust1` with `TRUST1_KEY`, `TRUST1_LINK` and `TRUST1_SERVER`,
  the download is `trust1-vault-extension.zip`, and exports are named
  `trust1-vault-export-*`. Encryption contexts, the export format and stored
  data are unchanged, so existing vaults, exports and repository keys keep
  working.
- Deploys can serve alias domains next to the main one (`aliasDomains` in the
  deploy state).

- Build and deploy scripts are TypeScript, run directly by Node 22.18 or later
  and type-checked by `npm run typecheck`; the hand-written `.d.mts` files are
  gone and `.node-version` pins Node 22 for Workers Builds.
- Removed `npm run preview` and its stubbed popup harness.

- Worker configuration follows Cloudflare's current best practices:
  compatibility date 2026-10-13 with `nodejs_compat`, source maps uploaded,
  explicit log sampling, structured JSON logs, and the required secrets declared
  so a deploy fails if one is missing.
- `npm run deploy:ci` deploys from `deploy/production.json` (migrations, build,
  deploy) for Workers Builds.

- Settings moved into the console. The extension has two surfaces left: the
  popup for daily use, and the console, whose sidebar holds Personal
  (preferences, security, password health, data, account) and Organization.
  The browser's extension options and every Settings link open it.
- The dashboard's scripts and stylesheets carry a content hash in their name and
  are cached for a year, while `/app/` itself is always revalidated, so a deploy
  reaches every browser on the next load.
- Revealing or copying the same secret again in one session is logged once, and
  access logs are sent in one request every few seconds or when the page is
  hidden.

- The console uses the full window width and shows less: no descriptions under
  page titles, no key fingerprints in tables (a Verify key action shows one when
  needed), no key version badges unless a team needs a new key, and the activity
  log keeps the IP address in a tooltip.

- Organizations are managed in a console instead of a Settings tab: a sidebar
  with Projects, Teams, Members, Activity and Settings, a link for every page,
  searchable tables and dialogs instead of browser prompts. A project opens on an
  overview of every secret against every environment that flags what is
  missing; a secret can be added to several environments at once; deleting a
  project or team asks for its name. The activity log names the project and
  environment of each secret event and filters by kind. The same console runs at
  `/app` and, without signing in again, as an extension tab opened from Settings
  → Organization or the popup.

- New passkeys carry the 1PW AAGUID `8c3f47c7-7c94-4ad9-9344-8fbe58a9b394`
  instead of all zeros, so sites can name 1PW as the provider once the AAGUID is
  in the community list. Existing passkeys keep the zero AAGUID.

- The unlock screen leads with a single fingerprint button when Touch ID or
  Windows Hello is on, with the PIN or master password below it.

- With Touch ID or the Mac password turned on, the popup asks for it as soon as
  it opens instead of waiting for a click, and after a master-password unlock
  the popup offers to turn it on. Only one suggestion banner shows at a time.
- Vault items move from the shared D1 database to one Durable Object per
  account, copied over on the first request after the upgrade. Each account's
  items now sit in their own database, and D1 keeps only accounts, sessions and
  shares.
- The threat model is published at /security on the hosted site. The landing and privacy
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

- The activity log checks the hash chain of the page it returns against the
  entry before it, instead of re-hashing the whole log on every request.
- Organization, invitation and account writes count against the per-account
  write limit.
- Fetching a site icon stops reading once the response passes 64 KB instead of
  buffering it whole, and the registration token is compared through SHA-256
  digests so its length does not leak.

- Importing, adding a secret to several environments, deleting an environment
  and removing duplicates now take one request per 500 secrets instead of one
  per secret (`POST …/secrets` and `POST …/secrets/delete`, each one
  transaction).

- Console dialogs show their errors inside the dialog and lock their button
  while working. Before, a failed import or add showed its error behind the
  dialog, so it looked like the button did nothing, and every retry created the
  same secrets again. Adding and importing now read the environment fresh from
  the server and replace secrets by name. A project with duplicate names offers
  to remove them, keeping the newest.
- Fewer hints in dialogs and on the sign-in page.

- The extension no longer offers to save, or fills, the master password on the
  vault's own server (the dashboard at `/app`), and the dashboard clears the
  password field before signing in so the browser has nothing to offer to save.
  Its fields and button now share one width and height.

- Touch ID unlock no longer fails with "didn't confirm it's you" when the popup
  asked for a second prompt while the first was still open. The server keeps a
  few open challenges per session and the extension never runs two prompts at
  once.

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

[Unreleased]: https://github.com/Linhv14/personal-vault/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Linhv14/personal-vault/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Linhv14/personal-vault/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Linhv14/personal-vault/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Linhv14/personal-vault/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Linhv14/personal-vault/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Linhv14/personal-vault/releases/tag/v0.1.0
