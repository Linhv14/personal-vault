# Architecture

7key is three programs sharing one cryptographic core: a browser extension that
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

**Extension.** The popup holds the main vault interface: setup, unlock, the item
list with live 2FA codes, the editor, the generator and sharing. Settings and
import are standalone pages that reuse the same UI foundation. It
derives keys, encrypts and decrypts. The service worker does what must outlive
the popup: the auto-lock alarm, clearing the clipboard 30 seconds after a copy,
registering the autofill page script, answering that script, and the identity
provider step of single sign-on, which must survive the popup closing. An offscreen
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
extension/    The MV3 extension: Preact UI pages, service worker, page script, offscreen document.
cli/          The 7key command: login (password or SSO over a loopback redirect), link,
              run, read, inject, agent, and the CI client the GitHub Action ships.
commercial/   Single sign-on and licence keys, under the 7key Commercial License. Reached
              only through src/worker/index.ts, extension/commercial.ts and
              extension/commercial-background.ts.
share/        The share page, the neutral home page, the security and API pages.
migrations/   D1 schema, applied in order by `npm run deploy`.
scripts/      Build, deploy and packaging tools, in TypeScript run by Node.
test/         Unit tests, and end-to-end tests against a live local Worker.
```

`src/core` throws `VaultError` with a stable code and never produces prose. If
it returned sentences, the UI would have to match on them, and every wording
change would break a translation.

## UI state and rendering

The extension's user-facing pages use Preact with `@preact/signals`. Shared
components live under `extension/ui`, while storage, crypto, sync and autofill
remain in `extension/lib` and `src/core`. This keeps the security-sensitive
logic independent from rendering and lets lock state, locale and item state
update without manually synchronizing a large DOM template. Injected scripts
that run in web pages remain framework-free IIFEs.

```
extension/ui/          Shared by every page: Icon, IconButton, Logo, Toast,
                       Button, Card, the signal-backed translator, date format.
extension/popup/
  main.tsx             Boot and screen switch.
  state.ts             Signals (items, selection, filters) and shared actions.
  filters.ts           Pure list logic: scope, type, search, sort, site match.
  edit-fields.ts       Pure editor logic: FormData to item fields.
  screens/             Setup, Unlock, Vault (two panes), Detail, Editor,
                       Generator, Share.
  components/          Topbar, Drawer, ListPane, Row, FieldRow, Totp, Menu…
extension/console/      The one place for settings and organizations, opened as
                       an extension tab and served at /app on the web.
  ConsoleApp.tsx       Sidebar (Personal and Organization groups) and routing
                       (#/me/<page>, #/<org>/<page>/…).
  pages/               Projects, Project, Teams, Team, Members, Activity,
                       Settings, Welcome.
extension/settings/
  state.ts             Local state and storage watcher for the personal pages.
  pages/               General, Security, Health, Data, Account, shown by the
                       extension's console only.
extension/import/      One page that walks pick, passphrase, review, done.
```

Forms are uncontrolled and read with `FormData` on submit; anything that can be
pure (filtering, editor parsing, recovery code marks) lives outside components
and has its own unit tests.

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
