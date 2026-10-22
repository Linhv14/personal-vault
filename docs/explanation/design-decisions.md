# Design decisions

Choices that a reader would otherwise question or undo, grouped by area. Each
records what was decided and why; the cryptographic choices are in
[Cryptography](cryptography.md).

## Scope

7key is a password manager for one person or a small group, built so that
signing in no longer needs a phone for the 2FA code.

In scope: logins with passwords, notes and 2FA secrets; password generation;
temporary share links; sync across devices; autofill on websites; English and
Vietnamese.

Out of scope, on purpose:

- **Vaults shared between accounts.** They need public-key cryptography and key
  rotation on membership changes, a large surface for a small audience. Share
  links cover the common case of handing over one login.
- **A web vault.** A page served by the operator could be changed by the
  operator to read the master password. Keeping all key handling in an
  installed extension removes that option.
- **Real-time sync.** Durable Objects and WebSockets would add cost and moving
  parts; syncing on open is enough for one person's devices.
- **Account recovery.** See [Threat model](threat-model.md).

## Deployment

**Everyone can run their own server.** A password manager on someone else's
infrastructure asks you to trust that operator not to change the code, not to
be breached, and to still exist next year. Deploying to your own Cloudflare
account removes the operator. A shared server is supported for people who
accept that trust; see [Run a shared server](../how-to/run-a-shared-server.md).

**Cloudflare Workers and D1.** A personal vault fits inside the free tier,
needs no machine to patch, and is reachable from anywhere over HTTPS.

**A deploy script instead of plain Wrangler.** Wrangler does not create a D1
database when the binding has no id, and the repository must not contain
anyone's account or database id. `npm run deploy` resolves the account, finds
or creates the database, renders `.wrangler.local.toml` from the template,
applies migrations, generates secrets, deploys, and rebuilds the extension with
the Worker URL. It is idempotent, so the same command installs and upgrades.

**The deploy script writes generated secrets to a file, not the terminal.**
Terminal output gets scrolled back, screenshotted and pasted into bug reports;
`.secrets.local.txt` is written once and meant to be moved offline. The
registration token is shorter than the other secrets (24 bytes rather than 32)
because someone types it into the extension by hand; the others never leave
the server. `npm run dev` generates its own local secrets and never uses the
production ones.

**The Worker URL is baked into the extension at build time.** `npm run deploy`
remembers the URL it deployed to, and the next build uses it as the default
server, so a fresh install does not ask its owner to retype the address of
their own server. Without a deployment the build falls back to the hosted
service in `deploy/production.json`, and only with neither is the default
empty.

**esbuild, not a full bundler.** The share page and the extension compile to
plain JavaScript; Vite or webpack would only add something else to maintain.
Release builds carry no source maps, so a published extension does not ship a
map pointing back at the source; development builds inline them.

**Wrangler, not the `cf` CLI.** Cloudflare's `cf` CLI entered open beta in
September 2026. It uses a different configuration format and also does not
provision a database for an unbound binding. Moving brings churn for no gain
while Wrangler is supported. The deploy script is not installed as a `cf`
command, so it cannot shadow the real one.

**`workers.dev` stays on with a custom domain.** Extensions built before the
domain was added still point at `workers.dev`. Disabling it would strand them.

**Resend by default for email.** Cloudflare Email Sending needs the Workers Paid
plan. Resend's free tier works with the free plan and authenticates the domain
with DKIM and SPF. Emails carry no tracking and no remote images; the logo is
attached inline (`cid:`), so opening a message loads nothing from a server.

## Server

**Bearer tokens, not cookies.** The API is called from extension pages, so a
header costs nothing, and with no cookies a malicious page cannot make the
browser attach a session to its own request.

**Deletes are tombstones.** A deleted item keeps its row with `deleted_at` set
and its ciphertext erased. Removing the row would leave offline devices unaware
of the deletion, and they would upload the item again.

**An item is one sealed blob,** URL and title included. Matching a page to a
login happens after decryption on the device. A URL column in the clear would
hand the server the list of every site the user has an account on.

**Ciphertext is base64 text, not BLOB.** D1's HTTP API serializes BLOBs
awkwardly, and base64 costs a third more space on records that are small.

**Coarse error codes.** One code covers a wrong email or a wrong password, and
one covers every kind of dead share. A precise answer would tell an attacker
which half of a guess was right.

**Errors never echo their cause.** A D1 error can contain the SQL statement;
unhandled errors return `server.error` and go to the log only.

Each error response still carries an English `error` sentence next to its
`code`. The extension localizes the code; the sentence is there so someone
calling the API with curl gets something readable without a table.

**Share ids are random, not a counter.** Sequential ids would let anyone
enumerate every share that currently exists.

**The client mints item ids.** Creating and updating an item are the same `PUT`,
so retrying after a dropped connection is idempotent instead of creating a
duplicate.

**Last write wins, on the server clock.** Two devices editing the same item in
the same second is not worth more machinery for a personal vault.

## Extension

**Preact + Signals for extension pages.** The popup and standalone pages need
reactive state for lock changes, sync, live TOTP codes, async health checks and
locale changes, but a full framework would add unnecessary weight to a browser
extension. Preact keeps the component model small, while Signals make shared
session and locale state observable across pages. The crypto, storage and
autofill layers stay framework-free, and scripts injected into websites remain
plain IIFEs to minimize their page-facing surface.

**Popup state lives in the popup.** Items, filters and the open screen are
signals in `extension/popup/state.ts`, not in the service worker, which MV3
stops after about 30 seconds idle. Forms stay uncontrolled and are read with
`FormData` on submit, so the editor renders any `TYPE_FIELDS` entry without one
piece of state per field.

**Vaults are encrypted labels, not separate keys.** A vault is a name, colour
and icon stored in one encrypted system record, and each item names its vault
inside its own ciphertext. The server sees neither. Sharing a vault with
another person needs per-vault keys wrapped to each member's public key; that
comes as its own design, and this layout leaves room for it.

**Creating a vault and signing in are two visible choices.** Signing in needs no
registration token; hiding that path behind a link led people setting up a
second machine to believe they needed a token they do not have.

**Unlock falls back to the offline cache only on a network failure.** A
rejected password must surface at once, not later as some other error.

**2FA codes use the server-corrected clock.** The popup measures clock skew
against the Worker and warns above ten seconds, where codes start failing near
a rollover.

**The vault key lives in `chrome.storage.session`.** MV3 stops an idle service
worker after about 30 seconds, so a key held in a variable disappears and the
popup asks for the master password again and again. Session storage is
memory-backed and cleared when the browser exits, and auto-lock clears it
earlier.

**By default the vault reopens after a browser restart, as Proton Pass does.**
Typing the master password on every browser start pushes people to weaker
passwords. With auto-lock set to "Never" (the default), the extension seals the
vault key under a random key that the server holds for that session and keeps
the sealed copy and the session token in `storage.local`. On restart it asks
the server for the session's key and opens the copy. The disk copy alone opens
nothing; with the session revoked (sign-out, 30-day expiry, password change) it
is useless and is deleted. "Lock now" and every timed or on-close auto-lock
delete it too, so anyone who wants the old behaviour picks one of those.

**`chrome.storage.local` holds only ciphertext and preferences.** The browser
writes it to disk unencrypted.
Mixing up the two storage areas has no visible symptom: everything keeps
working while the keys sit on disk. `test/popup.test.ts` therefore checks that
no key or plaintext ever lands in `storage.local`. Locking calls `clear()` on
the session area rather than removing named keys, so a field added later cannot
be left behind.

**Auto-lock is checked on every read, not only by the alarm.** MV3 can stop the
service worker and delay alarms, so the stored deadline is compared whenever
the vault key is read, and the popup is never shown an unlocked vault past its
deadline. Activity extends the deadline, so the vault does not lock mid-use.

**A dead session locks the vault.** When the server answers that the session is
gone, the extension locks and asks for the master password rather than
retrying with a token that will never work. A request that never reached the
server is reported separately from a failure, as `error.api.offline`, because
the vault keeps working from its cache. Signing out still succeeds when the
server cannot be reached: clearing local keys is what matters, and the session
expires on its own.

**One damaged item does not hide the list.** An item that fails to decrypt is
skipped and the rest of the vault still opens.

**The service worker clears the clipboard.** A timer in the popup dies when the
popup closes, which is usually right after copying. The service worker sets an
alarm and clears the clipboard from an offscreen document. Without the
`clipboardRead` permission, and the install warning that comes with it, it
cannot check what the clipboard holds, so the clear is unconditional:
something you copy yourself within those 30 seconds is cleared too.

**QR codes are read with Chrome's `BarcodeDetector`.** A bundled decoder would
see every 2FA secret before the user does. Where the API is missing, pasting
the setup key still works. Scanning captures the visible tab with
`activeTab`, so no broad permission is needed.

**Sign-in asks for no host permission.** The Worker's CORS policy admits
extension origins, so the popup can reach any server without one. Asking would
open Chrome's permission prompt, which closes the popup in the middle of
sign-up.

**Item types are one schema, not one screen each.** `TYPE_FIELDS` in
`extension/lib/item-types.ts` lists each type's fields and how they behave
(secret, card number, expiry, 2FA, codes). The editor, the detail view, search
and import all read it, so a new type is a new entry rather than four new
screens. The type lives inside the encrypted item, so the server cannot count
how many cards an account holds, and an item without one is a login, so
existing vaults need no migration. Autofill, passkeys and sharing stay
login-only: a page should never be able to ask for a card or an address.

**Import recognises the file instead of asking where it came from.** Each
source has a reader that turns its export into the same drafts
(`extension/lib/import/`), and `read-export.ts` picks the reader from the
file's shape: a zip's entries, a JSON's top-level keys, a CSV's columns. One
planner then skips duplicates and attaches passkeys for every source. A file
that is none of these is searched for recovery codes, so the same button
handles a GitHub codes file and a Bitwarden vault.

**`src/core` throws codes, not sentences.** The UI turns `VaultError` codes
into text in the user's language; core code never needs to know which.
The `message` on a `VaultError` is for developers, in logs, stack traces and
tests; it stays in English and is never shown.

**Translation is hand-rolled.** An i18n library would be a lot of third-party
code in an extension that holds every password its user owns, for what amounts
to a lookup and a string replacement. Translation happens only at the UI edge;
the crypto, the Worker and the vault model never know which language is
active. English is the source catalogue and every other locale is typed
against its keys, so a missing translation is a compile error rather than a
string that silently appears in English. The locale follows the browser's
language list, matching on the primary subtag (`vi-VN` uses `vi`), and falls
back to English, the one catalogue guaranteed complete. An unknown `{name}`
placeholder is left as written, so a typo shows in the UI instead of rendering
an empty string. Anything thrown that is not a `VaultError`, such as a bug or a
DOM exception, is shown with its own English message: better than hiding a
real failure behind a friendly phrase.

## Interface

**One source for the brand.** The name is `APP_NAME` in `src/core/brand.ts`,
the mark is `src/ui/logo.ts`, and the favicon and icons are rendered from that
SVG. Each inline logo gets its own gradient id: SVG ids are document-wide, and
when the first copy sits in a hidden screen, every other logo loses its fill.

**One source for colour.** `src/ui/tokens.css` defines every colour. The build
injects it wherever a stylesheet has a `/* @tokens */` marker (popup, share
page, security page, home page) and bundles it into the page script's shadow root. Teal is
the only accent: deep teal on a warm off-white in light mode, a luminous teal on
a teal-tinted ink in dark mode. Item icons use the same tint rather than one
colour per item, so nothing competes with the accent.

**The popup is two panes, 600 × 430.** The list stays on the left and the
selected item, editor, generator or share form opens on the right, so finding
and reading an item never collapses the list. Filters live in a type dropdown
and a scope switcher (favorites, tags, trash) instead of a row of chips that
scrolls off screen; the side menu holds only app actions.

## Platform traps

- **Scripts injected into pages share a scope.** All of an extension's content
  scripts run in one isolated world, and a MAIN-world script runs in the page's
  own global scope. Built as plain scripts, a top-level `send` in one replaced
  the `send` in another, and the passkey script exposed its variables to the
  page. Every injected script is therefore built as an IIFE; the list lives in
  `scripts/extension-entries.ts`, and a test checks it matches the scripts the
  extension registers.
- **`@cloudflare/workers-types` declares its own `Element`**, for
  HTMLRewriter, which conflicts with the DOM's. Worker and browser code use
  separate `tsconfig` files.
- **Wrangler on Windows** breaks when started through `npx` with a shell and
  Node lives in `C:\Program Files`. The deploy script runs Wrangler's entry file
  with the current Node binary instead.
- **A deploy with `routes` turns `workers.dev` off** unless `workers_dev` is
  set explicitly. The generated config always sets it.
- **Wrangler with access to several accounts** aborts `d1 list` and
  `d1 create` rather than guess, and those run before the generated config
  exists. Once the account is known, the deploy script passes it to every
  later call; without that the database lookup failed silently and the script
  tried to create a database that already existed. `d1 create` has no
  `--json`, so the script reads the list back to learn the new id.
- **Wrangler prints logs and JSON to the same stream.** The deploy script tries
  to parse JSON from each opening brace in turn: taking only the last brace
  lands inside a nested object, and taking only the first fails when a log
  line contains a brace. The Worker URL appears only in `deploy`'s output, so
  that output is captured as well as shown.
- **`wrangler dev` holds `dist/public` open**, and removing the directory fails
  with `EBUSY` on Windows; the build then clears its contents instead. The
  build only ever cleans its own outputs, never all of `dist/`, which also
  holds the packaged extension zips.
- **An MV3 service worker runs in its own module scope**, so it is bundled
  without code splitting: shared chunks would be files the manifest cannot
  declare.
- **TypeScript 5.7 made `Uint8Array` generic over its buffer**, while WebCrypto
  accepts only views over a plain `ArrayBuffer`. `src/core/bytes.ts` exports a
  `Bytes` alias for `Uint8Array<ArrayBuffer>` and copies into a fresh buffer
  where needed, instead of casting at every `crypto.subtle` call.
- **The Worker's `tsconfig` has no DOM library**, on purpose: a Worker file that
  reaches for `document` or `localStorage` fails at typecheck rather than at
  runtime.

### PIN unlock is a server-limited second key

A 6-digit PIN has a million values, so anything that can be tested offline
falls in seconds. The PIN therefore never protects the vault key alone: PBKDF2
turns it into a verifier, which goes to the server, and a local half, which
stays on the device. The vault key is sealed under HKDF of the local half and a
random `pin_key` that the server hands out only for the right verifier. A thief
with the disk has the salt and the sealed copy but not `pin_key`; the server has
`pin_key` and a keyed hash of the verifier but not the salt, so neither can
guess offline. Online guessing stops at five: the server spends a try before it
compares, in one `UPDATE … RETURNING`, so parallel requests cannot race past
the limit, and the fifth miss deletes `pin_key`. The PIN is tied to the session
whose token it keeps on disk, so the 30-day session expiry, sign-out and a
password change all end it and the master password is needed again.

### Touch ID and Windows Hello through WebAuthn, checked by the server

Extension pages can call WebAuthn with their own origin, and Chrome hands the
request to the platform authenticator: Touch ID on a Mac, Windows Hello on
Windows. The private key never leaves the Secure Enclave or the TPM, so the
server can treat a signature as proof that the device and its owner were
there. Setting it up registers the credential's public key with the session and
returns a random `bio_key`; the vault key is sealed under HKDF of `bio_key` and a
random secret kept on the device. Unlocking asks for a one-time challenge,
signs it with user verification, and gets `bio_key` back only if the server
verifies the signature, so neither the disk nor the server alone opens the
vault, and a recorded unlock cannot be replayed. This works without the PRF
extension, which not every Windows Hello setup offers. Like the PIN, it lives
and dies with the session.
