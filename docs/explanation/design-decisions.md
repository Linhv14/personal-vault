# Design decisions

Choices that a reader would otherwise question or undo, grouped by area. Each
records what was decided and why; the cryptographic choices are in
[Cryptography](cryptography.md).

## Scope

1PW is a password manager for one person or a small group, built so that
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

## Extension

**The vault key lives in `chrome.storage.session`.** MV3 stops an idle service
worker after about 30 seconds, so a key held in a variable disappears and the
popup asks for the master password again and again. Session storage is
memory-backed and cleared when the browser exits, and auto-lock clears it
earlier.

**`chrome.storage.local` holds only ciphertext and preferences.** The browser
writes it to disk unencrypted.

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

**`src/core` throws codes, not sentences.** The UI turns `VaultError` codes
into text in the user's language; core code never needs to know which.

## Interface

**One source for the brand.** The name is `APP_NAME` in `src/core/brand.ts`,
the mark is `src/ui/logo.ts`, and the favicon and icons are rendered from that
SVG. Each inline logo gets its own gradient id: SVG ids are document-wide, and
when the first copy sits in a hidden screen, every other logo loses its fill.

**One source for colour.** `src/ui/tokens.css` defines every colour. The build
injects it wherever a stylesheet has a `/* @tokens */` marker (popup, share
page, privacy page) and bundles it into the page script's shadow root. The
accent is a deep teal on warm neutrals, lighter in dark mode, where a saturated
accent vibrates against a dark background.

## Platform traps

- **`@cloudflare/workers-types` declares its own `Element`**, for
  HTMLRewriter, which conflicts with the DOM's. Worker and browser code use
  separate `tsconfig` files.
- **Wrangler on Windows** breaks when started through `npx` with a shell and
  Node lives in `C:\Program Files`. The deploy script runs Wrangler's entry file
  with the current Node binary instead.
- **A deploy with `routes` turns `workers.dev` off** unless `workers_dev` is
  set explicitly. The generated config always sets it.
