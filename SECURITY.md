# Security

## Reporting a vulnerability

Open a [private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository rather than a public issue. There is no bug bounty.

Because every user runs their own deployment, a fix reaches people only when
they pull and redeploy. Advisories will state plainly whether existing data is
affected and whether a master password change is warranted.

## Scope and honesty about it

This is a personal project. It has **not** had an independent security audit.
If you need an audited password manager, use Bitwarden or 1Password. What this
project offers instead is a small codebase you can read end to end in an
afternoon, and infrastructure nobody else controls.

## Threat model

### What the server cannot learn

The Worker stores ciphertext and has no key. Site names, usernames, passwords,
TOTP secrets and notes are encrypted client-side with AES-256-GCM under a vault
key the server never receives.

Concretely: a full dump of the D1 database, plus the Worker source, plus the
secrets in Cloudflare, still decrypts nothing without a master password.

A dump of the database alone is not even something to guess passwords
against: the auth key hash and the wrapped vault key are both keyed by
`AT_REST_SECRET`, a Worker secret that is not in D1. With the database and the
secrets together, each guess still costs 600,000 PBKDF2-SHA256 iterations.

### What the server does learn

- The account email.
- Item count and modification times.
- Sign-in times and IP addresses.

Accepted for a single-user vault. If that metadata matters to you, this design
is not sufficient.

### What is explicitly out of reach

- **A forgotten master password.** There is no recovery, by design. A recovery
  backdoor is a backdoor.
- **A compromised endpoint.** Malware on the machine running the extension can
  read the vault once it is unlocked. No client-side design survives this.
- **The channel carrying a share link.** A link's fragment holds its decryption
  key, and whatever app transports the link can read it. Use the optional extra
  passphrase, delivered separately, when that matters.

## Design decisions that carry security weight

| Decision                                                         | Reason                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Auth key and encryption key derived separately via HKDF          | The server authenticates you without holding anything that decrypts the vault     |
| Random vault key, wrapped by a password-derived key              | Changing the master password re-wraps one key instead of re-encrypting every item |
| PBKDF2-SHA256, 600,000 iterations                                | Built into WebCrypto; avoids a WASM dependency in the path of every password      |
| AES-256-GCM, fresh 12-byte nonce per encryption                  | Authenticated: tampering fails loudly rather than yielding plausible garbage      |
| No content script in the extension                               | It never gains read/write access to the pages you visit                           |
| Vault key in `chrome.storage.session` only                       | That area is memory-backed; `storage.local` is on disk in the clear               |
| No dependencies in `src/core`                                    | Every library there would sit in the path of your passwords                       |
| Registration gated by a secret token                             | An exposed Worker is otherwise an open signup page                                |
| Open registration (opt-in) capped per network and account        | A shared server cannot be flooded by one client or one account                    |
| Prelogin returns decoy KDF params for unknown emails             | Registered addresses cannot be enumerated                                         |
| Login limited to 10 failures per 15 minutes                      | Blocks online guessing                                                            |
| Anonymous endpoints limited to 30 requests/min per IP            | One client cannot exhaust the free-tier quota or hammer share ids                 |
| Auth hash and wrapped key keyed by `AT_REST_SECRET`              | A leaked D1 database alone gives nothing to guess passwords against               |
| Change of master password requires the current auth key          | A stolen session token cannot replace the wrapped key and lock the owner out      |
| Each item sealed with its id as associated data                  | The server cannot swap ciphertext between items                                   |
| Clipboard cleared by the service worker after 30s                | Still happens after the popup closes                                              |
| Share page served with a strict CSP and `frame-ancestors 'none'` | No injected script or framing on the page that shows a secret                     |

## Verifying the claims yourself

The strongest assertions in this README are enforced by tests, not prose:

```bash
npm test
```

- `test/crypto.test.ts` — the auth key is not the master key; a wrapping key is
  non-extractable; tampering is detected; nonces never repeat.
- `test/popup.test.ts` — the vault key reaches `storage.session` and never
  `storage.local`, and no plaintext appears in anything sent to the server.
- `test/e2e.test.ts` — against a real Worker and D1, no plaintext appears in any
  response.
- `test/totp.test.ts` — all 18 RFC 6238 vectors across SHA-1/256/512.
