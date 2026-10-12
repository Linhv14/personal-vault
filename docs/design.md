# Design

Status: implemented. Written 2026-10-11.

Deployment model: everyone runs their own copy on their own Cloudflare account
(`npm run deploy`). There is no shared server.

## 1. Goals

A personal password manager as a browser extension, built so that logging in no
longer requires reaching for an authenticator app on a phone.

In scope:

- Account records (title, url, username, password, note), end-to-end encrypted.
- TOTP secrets, with codes generated and refreshed in the extension itself.
- Password generation: random, passphrase, PIN.
- Temporary share links with an expiry and a view limit, carrying a
  self-refreshing 2FA code for the recipient.
- Multi-device sync behind one master password.
- English and Vietnamese UI.

Out of scope, deliberately:

- Autofill into web pages (which is why there is no content script).
- Shared vaults between accounts.
- A full web vault; the site serves only `/s/:id`.
- Realtime sync (Durable Objects, WebSockets).

## 2. Trust model

The server never receives a key capable of decrypting anything. All encryption
and decryption happen on the client; the server stores ciphertext and handles
authentication and sync.

What the server **does** learn, accepted as a trade-off for a personal vault:

- The account email.
- How many items exist and when each was last modified.
- Sign-in times and IP addresses.

What it never learns: site names, usernames, passwords, TOTP secrets, notes.

### Key hierarchy

```
master password + email (salt)
        |
        +-- PBKDF2-SHA256, 600,000 iterations --> master key (32B)
                    |
        +-----------+-----------+
        | HKDF info="auth"      | HKDF info="enc"
        v                       v
   auth key                wrapping key
   (sent to server)        (never leaves the client)
        |                       |
        v                       v
 server stores a hash     unwraps wrapped_vault_key
 of the auth key          --> vault key (32B, random)
                                |
                                v
                      AES-256-GCM per item
```

Why each layer exists:

1. **Auth key and encryption key are separate.** The server needs something to
   identify you with, and that something must not decrypt the vault. Using one
   key for both is the most common mistake in a hand-rolled password manager.
2. **The vault key is random and wrapped.** Changing the master password only
   re-wraps it; no item is re-encrypted. Without this layer, a password change
   on a 500-item vault is 500 writes and one chance to lose data partway.
3. **KDF parameters live on the account record** (`kdf_type`, `kdf_iterations`,
   `kdf_salt`), so moving to Argon2id later does not invalidate existing vaults.
4. **Each item is bound to its id.** Items are sealed with the associated data
   `personal-vault/item/<id>`, so a server cannot swap one item's ciphertext
   into another's slot: it fails the GCM tag instead of showing the wrong
   secret under the right name. Items written before this binding existed are
   re-encrypted automatically after the next online sync; from then on that
   device refuses unbound ciphertext.

### What a leaked database is worth

Two columns could be used to test password guesses offline: `auth_key_hash`
and `wrapped_vault_key`. Both are protected by a second, server-side key,
`AT_REST_SECRET`, held as a Worker secret and never stored in D1:

- `auth_key_hash` is `HMAC-SHA256(k_auth, auth key)`, not a bare SHA-256.
- `wrapped_vault_key` is sealed again with AES-256-GCM under `k_wrap`, with the
  account id as associated data so rows cannot be swapped between accounts.

`k_auth` and `k_wrap` are derived from `AT_REST_SECRET` with HKDF. A dump of D1
alone therefore offers nothing to guess against. Only an attacker holding the
database **and** the Worker secrets is back to a PBKDF2-SHA256 600,000 guess
per attempt — the same position as against a Bitwarden server.

Rows written before this layer carry no `v2:` prefix. They are still accepted
and rewritten in protected form on the account's next successful login.

`AT_REST_SECRET` must be backed up. Losing or replacing it makes every hash
unverifiable and every wrapped key unopenable: all accounts are locked out.
`npm run deploy` writes it to `.secrets.local.txt` exactly once for that reason;
move it somewhere offline and delete it from the file.

### Why PBKDF2 rather than Argon2id

Argon2id is stronger — memory-hard, far better against GPUs — but needs a WASM
library inside the extension. In an application holding every password you own,
each external dependency is a place malicious code could be planted, and that
supply-chain risk outweighs the gain here. PBKDF2-SHA256 at 600,000 iterations
is built into WebCrypto, needs nothing, and matches Bitwarden's default. The
upgrade path is open through `kdf_type`.

## 3. Architecture

```
+---------------------+          +------------------------------+
| Extension (MV3)     |          | Cloudflare Worker (Hono)     |
| - popup UI          |<-------->| /api/auth/*    sign in       |
| - service worker    |  HTTPS   | /api/items     delta sync    |
|   holds vault key   | (cipher  | /api/shares    create/read   |
| - TOTP, generator   |  text    | /s/:id         share page    |
| - ciphertext cache  |  only)   +-------------+----------------+
+---------------------+                        |
                                      +--------v-------+
                                      | D1 (SQLite)    |
                                      | ciphertext only|
                                      +----------------+
```

`src/core/` is shared by the Worker, the extension and the share page. It
depends on nothing but WebCrypto, so it runs in all three without polyfills.

`src/i18n/` sits at the UI edge only. `src/core` throws `VaultError` with a
stable code and never produces prose; if it returned sentences, the UI would
have to match on them and every wording change would break a translation.

## 4. Database schema

See [`migrations/0001_init.sql`](../migrations/0001_init.sql). Three decisions
worth restating:

- **An item is one encrypted blob**, including its `url` and `title`. Matching
  the current tab's domain happens client-side after decryption. Storing `url`
  in the clear so the server could query it would leak the full list of sites
  you hold accounts on.
- **Deletes are tombstones** (`deleted_at`), not row removal. A real DELETE
  leaves an offline device unaware, and it syncs the item back on reconnect.
- **Ciphertext is base64 in TEXT columns**, not BLOB. D1's HTTP API makes BLOB
  serialization awkward and base64 costs only 33% more space.

## 5. TOTP

Secrets arrive by three routes, all funnelled through one parser:

1. A base32 string pasted by hand — every site offers one behind a "can't scan
   the QR code?" link.
2. A QR code read from a screenshot of the open tab, via
   `chrome.tabs.captureVisibleTab()` and Chrome's built-in `BarcodeDetector`.
   Nothing is uploaded, and `activeTab` is the only permission needed.

   A QR decoding library was considered and rejected: it would sit in the path
   of the TOTP secret, seeing it before the user does. Where `BarcodeDetector`
   is unavailable, pasting by hand still works.

3. An `otpauth://` URI.

Codes follow RFC 6238 and are computed entirely offline:

```
counter = floor(unix_time / period)
hmac    = HMAC-SHA1(base32_decode(secret), counter as 8-byte big-endian)
offset  = hmac[last] & 0x0F
code    = (4 bytes at offset, high bit masked) % 10^digits
```

HMAC-**SHA1** per the RFC. SHA-1 is broken for collisions, not inside an HMAC,
so it remains sound; switching to SHA-256 would produce codes sites reject.

**Clock drift** is the failure mode nobody diagnoses unaided: codes look
perfectly normal while every site rejects them. At unlock the extension reads
`/api/time`, stores the offset, applies it to every computation, and warns when
it exceeds ten seconds.

## 6. Password generation

`crypto.getRandomValues()` only, never `Math.random()`. Modulo bias is avoided
by rejection sampling. Three modes: random, EFF-short-wordlist passphrase, and
numeric PIN, each reporting entropy in bits computed from the actual alphabet or
word list.

## 7. Share links

```
1. Pick an item -> choose a TTL (1h/24h/7d) and a view limit
2. share_key = 32 random bytes, client-side only
3. Encrypt {username, password, totp, note} under share_key
4. POST the ciphertext -> the Worker stores it and returns an id
5. Link: https://your-worker/s/<id>#<base64url(share_key)>
                                    ^ a fragment is never sent to a server
6. Recipient opens it -> the page reads location.hash -> GETs the ciphertext ->
   decrypts locally -> shows a live 2FA code if one was included
7. The Worker increments view_count; a cron purges expired rows hourly
```

**The limitation to be honest about:** whatever channel carries the link can read
all of it, fragment included, because to that channel a link is just text. Your
server stays blind; the messenger does not. 1Password has the same constraint.
Mitigations: short TTL and a single view by default, plus an optional extra
passphrase mixed into the key through HKDF and delivered separately.

## 8. Suggesting logins on websites

Off by default. Turning it on in Settings requests `https://*/*` and
`http://*/*` and registers `content/content.js` at runtime; turning it off
unregisters the script and drops the permission. Without it the extension
touches no page at all.

When on, focusing a password field (or the username field before it) shows an
icon. Clicking it asks the service worker for logins matching the page:

- **Trust comes from Chrome, not the page.** The service worker derives the
  domain from `sender.url` and serves only the top frame of an https page
  (http only on localhost). A page cannot claim to be another site, and a
  framed login cannot be filled.
- **Suggestions carry no secrets.** The menu receives titles and usernames.
  Only the login you click is sent back, and only if it matches the domain,
  even if the page somehow learns another item's id.
- **Nothing happens without a real click.** Every action checks `isTrusted`;
  the UI lives in a closed shadow root.
- **Shared hosting is split by tenant.** `alice.github.io` and
  `mallory.github.io` are different sites, as are any two IP addresses.

Submitting a form with a password stores it in `chrome.storage.session` for
five minutes, keyed by tab, and the page (or the next one, after navigation)
offers to save or update it. Locking the vault clears it.

## Brand and theme

- The name lives in `src/core/brand.ts` (`APP_NAME`) and the logo in
  `src/ui/logo.ts`; the favicon and extension icons are rendered from that SVG.
  Each inline logo gets its own gradient id: a shared id resolves to the first
  copy in the document, and when that copy sits in a hidden screen every other
  logo loses its fill.
- Colors live only in `src/ui/tokens.css`. The build injects it wherever a
  stylesheet carries the `/* @tokens */` marker (popup, share page, privacy
  page) and bundles it into the page script's shadow root, so a palette change
  is one edit. The accent is a deep teal on warm off-white neutrals, lightened
  for dark mode, where a fully saturated accent vibrates.

## 9. Known traps

- **MV3 kills the service worker after ~30s idle.** A vault key held in a plain
  variable disappears, and the popup starts demanding the master password
  repeatedly. It lives in `chrome.storage.session` instead — memory-backed,
  cleared when the browser closes — behind a 15-minute auto-lock.
- **Never write the vault key or plaintext to `chrome.storage.local`**; that
  area is on disk in the clear. It holds ciphertext and settings only.
- **The clipboard is shared with every running application** and clipboard
  managers persist history, so copies are cleared after 30 seconds. A timer in
  the popup dies the moment the popup closes, which is usually right after
  copying, so the service worker owns the timer (`chrome.alarms`) and clears the
  clipboard from an offscreen document. Without the `clipboardRead` permission
  (and the install warning that comes with it) it cannot check what the
  clipboard holds, so the clear is unconditional: something you copy yourself
  within those 30 seconds is cleared too.
- **`@cloudflare/workers-types` defines HTMLRewriter's `Element`**, which
  collides with the DOM's. Worker and browser code therefore use separate
  `tsconfig` files.

## 10. Cost

Comfortably inside Cloudflare's free tier (Workers 100k requests/day, D1 5GB).
On a `*.workers.dev` subdomain there is nothing to pay at all.

## 11. Deployment tooling

`npm run deploy` (`scripts/vault.mjs`) wraps Wrangler rather than calling it
directly, because no Cloudflare CLI creates a D1 database automatically when the
binding has no id — not Wrangler 4.149, and not the `cf` beta. The script
resolves the account, finds or creates the database, applies migrations,
generates secrets, builds and deploys, and is safe to run repeatedly.

It is reached through npm scripts and is deliberately **not** installed as a
`cf` binary: Cloudflare shipped an official CLI by that name in open beta in
September 2026, and shadowing it would be hostile to anyone who uses both.

Migrating to `cf` is plausible later. It is held off for now because it is beta,
authenticates separately, replaces `wrangler.toml` with `cloudflare.config.ts`,
and takes database IDs where Wrangler takes names — all churn for a project
whose deployment story already works. Wrangler is supported for 18 months past
the beta, which is ample notice.
