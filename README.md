# Personal Vault

A password manager you deploy to your own Cloudflare account: a browser
extension, a Worker, and a D1 database that holds nothing but ciphertext.

It exists to make reaching for the authenticator app on your phone unnecessary —
2FA codes appear in the extension and refresh themselves.

- **End-to-end encrypted.** The server stores ciphertext and has no key.
- **TOTP built in**, computed offline per RFC 6238 and verified against all 18
  vectors in the specification.
- **Password generation** — random, passphrase or PIN — reporting entropy in bits.
- **Temporary share links** with an expiry and a view limit, carrying a live 2FA
  code. The recipient installs nothing.
- **Works offline** from the copy already synced to your machine.
- **English and Vietnamese**, following the browser's language.

Design and reasoning: [`docs/design.md`](docs/design.md).
Threat model and what is out of reach: [`SECURITY.md`](SECURITY.md).

## Why you deploy it yourself

There is no shared server, and that is the point rather than an inconvenience.

A password manager running on its author's infrastructure asks you to trust that
author — to trust they will not change the code to phone keys home, that they
will not be breached, that the service still exists next year. Running your own
means **the author has no access to your data at all**, however much they might
want it.

It fits inside Cloudflare's free tier (Workers 100k requests/day, D1 5GB). On a
`*.workers.dev` subdomain it costs nothing.

## Trust model in one diagram

```
master password + email
   └─ PBKDF2-SHA256 600k ─→ master key
         ├─ HKDF "auth" ─→ auth key       → sent to the server, decrypts nothing
         └─ HKDF "enc"  ─→ wrapping key   → NEVER leaves your machine
                             └─ unwraps the vault key → AES-256-GCM per item
```

The server **does** learn: your email, how many items you have, when they
changed, and when you signed in. It **never** learns site names, usernames,
passwords, TOTP secrets or notes.

Two limits stated plainly:

1. **Forget the master password and the vault is gone.** There is no recovery,
   deliberately — a recovery backdoor is a backdoor.
2. **Whatever app carries a share link can read all of it**, including the key
   after the `#`, because to that app a link is just text. Your server stays
   blind; the messenger does not. Use the optional extra passphrase, sent
   through a different channel, when that matters.

## Install

Requires Node 20+ and a Cloudflare account.

```bash
git clone <this repo> personal-vault
cd personal-vault
npm install
npm run deploy
```

`npm run deploy` is idempotent and does the whole job:

1. Opens a browser to sign in to Cloudflare if needed.
2. Asks which account to use, if you have more than one.
3. Creates the `vault` D1 database, or reuses it.
4. Applies migrations.
5. Generates `REGISTRATION_TOKEN`, `EMAIL_PROBE_SECRET` and `AT_REST_SECRET`,
   writing the registration token and `AT_REST_SECRET` to `.secrets.local.txt`
   (gitignored) rather than printing them to a terminal that gets scrolled back
   and screenshotted. **Back up `AT_REST_SECRET` offline**: if it is lost or
   replaced, every account on the Worker is locked out. Existing deployments
   get it on their next `npm run deploy`.
6. Builds and deploys, printing your Worker URL.

Then load the extension:

```bash
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**
and select `dist/extension`.

The popup opens on **New vault**. The server address is already filled in — the
deploy records your Worker URL and the build bakes it into the extension — so
you only supply your email, the registration token from `.secrets.local.txt`,
and a master password.

> `REGISTRATION_TOKEN` is what stops strangers creating accounts on your Worker.
> Without it, your URL is an open signup page.

## Setting up another machine

Clone, `npm install`, `npm run build`, load `dist/extension`, then choose
**Sign in** instead of New vault. You need three things:

- the server address — already filled in if you deployed from this checkout,
  otherwise copy it from `npm run status`
- your email
- your master password

**No registration token.** It exists only to gate account creation, so a second
machine never needs it. Everything else — items, 2FA secrets, notes — is pulled
down encrypted and decrypted locally with the key your master password unwraps.

Losing every device loses nothing: the vault lives in your D1 database, and
email plus master password is enough to reach it again. Losing the master
password loses everything, because nothing else can unwrap the vault key.

`test/e2e.test.ts` covers exactly this path against a real Worker, starting from
a client that holds no cached state.

## Running a shared server

By default only someone holding `REGISTRATION_TOKEN` can create an account,
which is right for a personal Worker. To let anyone who installs the extension
sign up on your server:

```bash
npm run deploy -- --open-registration    # switch back: --token-registration
```

The choice is remembered for later deploys. With registration open:

- Each network can create at most 5 accounts a day, and 5 a minute.
- Each account is limited to 5,000 items, 60 writes a minute and 20 sessions.
- Users can delete their own account and all its items from Settings.
- Vaults stay end-to-end encrypted: you, as the operator, cannot read them.
  You do hold everyone's ciphertext, so back up D1 and `AT_REST_SECRET`, and
  publish a privacy policy before inviting strangers.
- An email address is only an identifier; nothing is sent to it. Anyone can
  register an address they do not own, and registering a taken address tells
  them it exists. Add email verification before relying on addresses.

## Backups

- `npm run backup` exports the production database to `backups/` (gitignored,
  mode 600). It holds ciphertext only, but it is useless without
  `AT_REST_SECRET`, so store the two together, offline.
- Cloudflare D1 also keeps 30 days of point-in-time history:
  `npx wrangler d1 time-travel restore vault --timestamp=<ISO time> -c .wrangler.local.toml`.

## Publishing

- `npm run package` builds `dist/personal-vault-extension-<version>.zip` with
  your server URL baked in.
- [docs/chrome-web-store.md](docs/chrome-web-store.md) has the listing text,
  permission justifications and privacy answers the dashboard asks for.
- The privacy policy is served at `https://<your-worker>/privacy`.

## Upgrading from 0.1.x

0.2.0 changes the API and the at-rest format, so do these in order:

1. `npm run deploy`. It adds the new `AT_REST_SECRET` and writes it to
   `.secrets.local.txt`. Back it up offline, then delete it from that file.
2. Reload the extension on **every** machine (`npm run build`, then reload
   `dist/extension` in `chrome://extensions`). An old extension cannot change the
   master password against the new server, and items it creates are rejected by
   upgraded machines, which only accept items bound to their id.
3. Unlock once on each machine while online. The server upgrades the stored
   hash and wrapped key on that login, and the extension re-encrypts older items
   after its first sync.

## Commands

```bash
npm run deploy      # deploy (safe to repeat)
npm run dev         # Worker + local D1 at http://127.0.0.1:8787
npm run preview     # the popup as a web page, for UI work
npm run status      # which account and resources are in use
npm run logs        # tail the Worker
npm test
npm run typecheck
npm run format
```

## Notes on the tooling

`wrangler.toml` deliberately carries **no `account_id` or `database_id`** —
those belong to whoever deploys. `npm run deploy` writes them into
`.wrangler.local.toml` (gitignored) and runs Wrangler against that, so running
`npx wrangler deploy` directly will not work.

Cloudflare's own [`cf` CLI](https://developers.cloudflare.com/cf/) entered open
beta in September 2026 and will eventually replace Wrangler. This project stays
on Wrangler for now: `cf` is beta, uses a different configuration format, and
does not provision a D1 database automatically either. The deploy script is
intentionally _not_ exposed as a `cf` command so it cannot shadow the real one.

## Things that look odd but are deliberate

- **`src/core` has no dependencies.** Every library there would sit in the path
  of your passwords.
- **The extension has no content script**, so it never gains read or write
  access to the pages you visit. The cost is no autofill — you copy from the
  popup instead.
- **`chrome.storage.local` holds only ciphertext and settings**; it is on disk
  in the clear. The vault key lives in `chrome.storage.session`, which is not.
- **Deleting an item writes a tombstone** rather than removing the row, or an
  offline device would sync it back.
- **TOTP uses HMAC-SHA1**, as RFC 6238 requires. SHA-256 would produce codes
  that every site rejects.
- **QR scanning uses Chrome's `BarcodeDetector`**, not a bundled library: that
  library would see your 2FA secret before you do.

## License

MIT, and no warranty. This is a personal tool that has not had an independent
security audit. If you need an audited password manager, use Bitwarden or
1Password. What this gives you instead is a codebase small enough to read in an
afternoon and infrastructure nobody else controls.
