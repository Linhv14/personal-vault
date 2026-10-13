# Threat model

What 1PW protects, against whom, and where the protection ends. The mechanisms
behind each claim are in [Cryptography](cryptography.md); the tests that
enforce them are listed at the end.

## Assets

1. **Vault contents:** site names, URLs, usernames, passwords, 2FA secrets and
   notes.
2. **The master password**, which opens the vault on any device.
3. **Shared items**, while a link is alive.
4. **Metadata:** who has an account, how many items, when they sign in.

## Parties

| Party                 | Assumed capability                                     |
| --------------------- | ------------------------------------------------------ |
| Network attacker      | Reads and alters traffic outside TLS                   |
| Server operator       | Reads D1, reads and changes Worker code and secrets    |
| Database thief        | Holds a copy of D1, nothing else                       |
| Malicious website     | Runs script in a page the user visits                  |
| Link carrier          | The chat or email service that transports a share link |
| Device thief          | Holds a powered-off or locked device                   |
| Malware on the device | Runs code as the user while the vault is unlocked      |

## What each party can learn

| Party             | Vault contents                                                           | Master password                                          | Metadata                                                 |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------- |
| Network attacker  | No: TLS, and the payload is ciphertext anyway                            | No                                                       | Timing and size of requests                              |
| Database thief    | No                                                                       | No offline guessing without `AT_REST_SECRET`             | Emails, item counts, timestamps                          |
| Server operator   | No, as long as the extension is honest (see below)                       | Can guess offline at 600,000 PBKDF2 iterations per guess | Everything the database holds, plus IP addresses in logs |
| Malicious website | Only a login the user explicitly fills there, and only on its own domain | No                                                       | Whether autofill is on                                   |
| Link carrier      | The shared item, unless a passphrase was set and sent separately         | No                                                       | That something was shared                                |
| Device thief      | No, while locked: the local copy is ciphertext                           | Can guess offline against the cached wrapped key         | Email, item count                                        |
| Malware on device | Yes, once unlocked                                                       | Yes, if it logs keystrokes                               | Yes                                                      |

## What the server learns

The server, and so anyone who operates or breaches it, learns:

- each account's email address;
- how many items each account has, their approximate sizes, and when each one
  changed;
- when each device signed in, and the IP address of every request
  (Cloudflare's logs, not D1);
- that a share exists, its lifetime, view limit and whether it has been opened,
  but not who created it;
- addresses that requested a sign-up code or failed to sign in.

It never learns site names, URLs, usernames, passwords, 2FA secrets, notes, or
the contents of a share.

## Out of reach, by design

**A forgotten master password.** Nobody holds a copy and nothing can unwrap the
vault key without it. A recovery mechanism is a second way in, available to
whoever controls it.

**Malware on an unlocked device.** Code running as the user can read the
extension's memory, the screen and the keyboard. No client-side design survives
a compromised endpoint.

**The link carrier.** A share link's fragment is its key. The service that
carries the link can read it like any other text. A passphrase delivered over
a different channel closes this, at the cost of a second message. See
[Share links](share-links.md).

**A malicious server and an honest-looking extension update.** The extension's
code decides what it sends. An operator who also ships the extension can ship
one that sends keys home. Self-hosting from source you have read, or building
the extension yourself, is the defence. A Chrome Web Store build is only as
trustworthy as its publisher.

**Server-side rollback.** A server can return an older copy of an item, or
withhold a newer one; the extension cannot tell. Integrity of each item is
protected, freshness of the whole vault is not.

**Metadata.** The list above is accepted for a personal password manager. If
hiding who uses the server or when matters to you, this design is not enough.

## Specific defences

| Threat                                            | Defence                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login request reveals the vault key               | Auth key and wrapping key are separate HKDF outputs                                                                                                |
| Leaked database used to guess passwords           | Auth hash and wrapped key keyed by `AT_REST_SECRET`, which is not in D1                                                                            |
| Online password guessing                          | 10 failures per email per 15 minutes, then a 15-minute lock; 30 requests per minute per IP                                                         |
| Finding out which emails have accounts            | `prelogin` returns stable decoy parameters for unknown addresses; login timing is uniform; sign-up sends a different email instead of an error     |
| Strangers using a personal server                 | Account creation needs `REGISTRATION_TOKEN` unless open registration is chosen                                                                     |
| Flooding a shared server                          | Per-network daily account limit, per-account item and write limits                                                                                 |
| Server swaps ciphertext between items or accounts | Item id and account id are AES-GCM associated data                                                                                                 |
| Stolen session token replaces the password        | Changing the password or deleting the account needs the current auth key                                                                           |
| Stolen session token survives a password change   | Changing the password revokes every session                                                                                                        |
| Leaked database yields usable tokens              | Only SHA-256 hashes of session and revoke tokens are stored                                                                                        |
| Two people opening a single-view link at once     | The view is claimed in one conditional `UPDATE … RETURNING`                                                                                        |
| Probing a share's recipient list                  | Requesting a code returns the same answer for every address                                                                                        |
| A page impersonating another site to autofill     | The service worker uses the URL Chrome reports for the sender's top frame                                                                          |
| A page clicking autofill on the user's behalf     | Every action requires a trusted user event; the UI is in a closed shadow root                                                                      |
| A page using another site's passkey               | The RP ID is checked against the top-frame origin Chrome reports, no broader than its registrable domain; `clientDataJSON` carries the real origin |
| Copied password left on the clipboard             | Cleared after 30 seconds by the service worker, even after the popup closes                                                                        |
| Vault key written to disk                         | Kept only in `chrome.storage.session`, which is memory-backed                                                                                      |
| Script injection or framing on the share page     | Strict CSP, `frame-ancestors 'none'`, password never placed in the DOM                                                                             |
| Supply-chain attack through dependencies          | No dependencies in `src/core`; QR codes read with the browser's built-in `BarcodeDetector`                                                         |

## Verifying the claims

The strongest statements above are enforced by tests:

```bash
npm test
```

- `test/crypto.test.ts`: the auth key is not the master key; the wrapping key
  cannot be exported; one flipped bit is detected; every encryption uses a
  fresh nonce; items open only with the associated data they were sealed with.
- `test/at-rest.test.ts`: stored hashes and wrapped keys cannot be checked or
  opened without `AT_REST_SECRET`, and rows cannot be moved between accounts.
- `test/popup.test.ts`: the vault key reaches `storage.session` and never
  `storage.local`; no plaintext appears in any request.
- `test/autofill.test.ts`: suggestions carry no secrets; only matching domains
  are filled; shared-hosting tenants are kept apart.
- `test/e2e.test.ts`, against a real Worker and D1: no plaintext in any
  response, and a fresh client with only email and master password recovers
  the vault.
- `test/totp.test.ts`: all 18 RFC 6238 vectors.

The project has not had an independent security audit.
