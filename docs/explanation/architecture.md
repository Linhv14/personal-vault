# Architecture

1PW is three programs sharing one cryptographic core: a browser extension that
holds every key, a Cloudflare Worker that stores ciphertext, and a static page
that opens share links.

```
 ┌────────────────────────────┐            ┌───────────────────────────────┐
 │ Extension (Chrome MV3)     │            │ Cloudflare Worker (Hono)      │
 │                            │   HTTPS    │                               │
 │  popup        all UI       │ ─────────► │  /api/auth     accounts       │
 │  service      auto-lock,   │ ciphertext │  /api/items    delta sync     │
 │  worker       clipboard,   │   only     │  /api/shares   share links    │
 │               autofill     │            │  /s/:id        share page     │
 │  page script  optional     │            │  cron          hourly purge   │
 │  offscreen    clipboard    │            └──────────────┬────────────────┘
 └────────────────────────────┘                           │
                                                 ┌────────▼────────┐
 ┌────────────────────────────┐                  │ D1 (SQLite)     │
 │ Share page /s/:id          │ ── ciphertext ── │ ciphertext,     │
 │ key from the URL fragment  │                  │ hashes, metadata│
 └────────────────────────────┘                  └─────────────────┘
```

## Components

**Extension.** The popup holds the whole interface: setup, unlock, the item
list with live 2FA codes, the editor, the generator, sharing and settings. It
derives keys, encrypts and decrypts. The service worker does what must outlive
the popup: the auto-lock alarm, clearing the clipboard 30 seconds after a copy,
registering the autofill page script, and answering that script. An offscreen
document performs the clipboard clear, because a service worker has no
clipboard access.

**Worker.** A [Hono](https://hono.dev) application. It authenticates accounts,
stores and returns sealed items, stores and serves sealed shares, sends
one-time codes by email when configured, and purges expired rows hourly. It
holds no key that decrypts user data.

**D1.** One SQLite database. Every user field in it is ciphertext; the
remaining columns are identifiers, timestamps and hashes. See
[Data model](../reference/data-model.md).

**Share page.** A static page served by the Worker at `/s/:id`. It reads the
key from the URL fragment, fetches the ciphertext, and decrypts in the
recipient's browser. The recipient installs nothing.

## Code layout

```
src/core/     Crypto, TOTP, generator, share payloads. WebCrypto only, no
              dependencies; runs unchanged in the extension, the Worker and Node.
src/i18n/     Message catalogues (English, Vietnamese). Only the UI layer uses them.
src/ui/       Design tokens, logo and icons shared by the popup, page script and share page.
src/worker/   The Worker: routes, sessions, at-rest protection, email.
extension/    The MV3 extension: popup, service worker, page script, offscreen document.
share/        The share page and the privacy policy.
migrations/   D1 schema, applied in order by `npm run deploy`.
scripts/      Build, deploy, preview and packaging tools.
test/         Unit tests, and end-to-end tests against a live local Worker.
```

`src/core` throws `VaultError` with a stable code and never produces prose. If
it returned sentences, the UI would have to match on them, and every wording
change would break a translation.

## Data flow

### Unlock

1. The popup asks the server for the account's KDF parameters (`prelogin`).
2. It derives the master key from the password, then the auth key and the
   wrapping key from the master key.
3. It sends the auth key (`login`) and receives a session token and the wrapped
   vault key.
4. It unwraps the vault key with the wrapping key, which never left the
   device, and keeps the vault key in `chrome.storage.session` until auto-lock.

Details: [Cryptography](cryptography.md).

### Sync

Each device keeps the sealed items in `chrome.storage.local` and a cursor,
`lastSync`. On open and after unlock it asks for everything changed since the
cursor and merges by `updatedAt`, the server's timestamp; the newer write wins.

- **The cursor is the server clock.** If each device used its own, one running
  a few seconds fast would skip exactly the items it had just changed.
- **Deletes are tombstones.** A removed row would leave an offline device
  unaware, and it would upload the item again on reconnect.
- **Reads work offline; writes do not.** The list, search and 2FA codes come
  from the local copy. Saving or deleting needs the server, so two devices
  cannot diverge while one is offline.

### Share

The extension seals the chosen fields under a fresh random key, uploads the
ciphertext, and builds a link whose fragment carries the key. The Worker never
receives the fragment. See [Share links](share-links.md).

## Where state lives

| Place                    | Holds                                                                                            | Lifetime                                |
| ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `chrome.storage.session` | Vault key, session token, auto-lock deadline, pending autofill saves, unfinished sign-up         | Until lock or browser exit; memory only |
| `chrome.storage.local`   | Sealed items, wrapped vault key, KDF parameters, sealed list of created share links, preferences | On disk until sign-out                  |
| D1                       | Accounts, sealed items, sealed shares, hashes                                                    | Until deleted or purged                 |
| Worker secrets           | `AT_REST_SECRET`, `EMAIL_PROBE_SECRET`, `REGISTRATION_TOKEN`, `RESEND_API_KEY`                   | Until replaced                          |

`chrome.storage.local` is written to disk unencrypted by the browser, so it
holds nothing that is not already ciphertext or a harmless preference.
