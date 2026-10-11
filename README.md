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
5. Generates `REGISTRATION_TOKEN` and `EMAIL_PROBE_SECRET`, writing the
   registration token to `.secrets.local.txt` (gitignored) rather than printing
   it to a terminal that gets scrolled back and screenshotted.
6. Builds and deploys, printing your Worker URL.

Then load the extension:

```bash
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**
and select `dist/extension`.

On first run the popup asks for your Worker URL, your email, the registration
token from `.secrets.local.txt`, and a master password.

> `REGISTRATION_TOKEN` is what stops strangers creating accounts on your Worker.
> Without it, your URL is an open signup page.

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
