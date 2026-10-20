# Cryptography

Every primitive comes from WebCrypto, which browsers and Workers implement
natively. `src/core` has no dependencies, so no third-party code sits between a
password and its ciphertext.

## Primitives

| Purpose                                | Algorithm                     | Parameters                                                                            |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Master password → master key           | PBKDF2-HMAC-SHA256            | 600,000 iterations minimum; salt = normalized email ‖ 16 random bytes; 256-bit output |
| Master key → auth / wrapping key       | HKDF-SHA256                   | info `auth` and `enc`, empty salt                                                     |
| Encryption of items, vault key, shares | AES-256-GCM                   | Fresh random 96-bit nonce per encryption; 128-bit tag                                 |
| Share key with passphrase              | HKDF-SHA256                   | Passphrase as salt, info `share`                                                      |
| Recovery code → wrap / auth key        | HKDF-SHA256                   | 160-bit code; info `wrap` and `auth`                                                  |
| Server-side keyed hashes               | HMAC-SHA256                   | Keys from Worker secrets                                                              |
| Server-side key derivation             | HKDF-SHA256                   | info `personal-vault/at-rest/…`                                                       |
| 2FA codes                              | HMAC-SHA1 / SHA-256 / SHA-512 | Per RFC 6238, as the site specifies                                                   |
| Randomness                             | `crypto.getRandomValues`      | Rejection sampling for uniform choices                                                |

## Key hierarchy

```
master password + email + salt
        │
        └─ PBKDF2-SHA256, 600,000 iterations ──► master key (32 bytes)
                    │
          ┌─────────┴──────────┐
          │ HKDF "auth"        │ HKDF "enc"
          ▼                    ▼
       auth key           wrapping key ── never leaves the device
       sent at login           │
          │                    ▼ unwraps
          ▼               vault key (32 random bytes)
   server keeps an              │
   HMAC of it                   ▼ AES-256-GCM
                          each item, sealed with "personal-vault/item/<id>"
                          the list of created share links
```

Why each layer exists:

1. **Authentication and encryption use different keys.** The server needs
   something to recognize you by, and that thing must not decrypt the vault.
   HKDF with distinct labels makes the wrapping key impossible to compute from
   the auth key. Using one key for both jobs is the classic mistake of
   home-made password managers: anyone who sees a login request can then read
   the vault.
2. **The vault key is random and wrapped.** Changing the master password
   re-wraps one 32-byte key; no item is re-encrypted, so there is no
   half-finished state in which some items are under the old password.
3. **KDF parameters are stored per account.** `kdf_type`, `kdf_iterations` and
   `kdf_salt` travel with the account, so a later move to stronger parameters
   or another function does not strand existing vaults. The server refuses
   fewer than 600,000 iterations for a new password; an account created with
   fewer is told so at sign-in, and the client re-wraps the vault key at the
   current cost without asking.
4. **Each item is bound to its id.** The item id is AES-GCM associated data. A
   server that moves one item's ciphertext into another's row produces an
   authentication failure, not the wrong password shown under the right site.
   The account id is not part of it; it binds the server-side layer on the
   wrapped vault key, below. Items written before ids were bound are still
   opened on a device until it has rewritten them; see the
   [threat model](threat-model.md#integrity-of-stored-items).

## What the server holds, and what a copy is worth

The server stores two values that could test a password guess: the auth key
hash and the wrapped vault key. Both are protected again with keys derived
from `AT_REST_SECRET`, a Worker secret that is not stored in D1:

- `auth_key_hash` is an HMAC-SHA256 of the auth key under `k_auth`;
- `wrapped_vault_key` is sealed again with AES-256-GCM under `k_wrap`, with the
  account id as associated data, so rows cannot be swapped between accounts.

The same secret protects the other server-side values: the copy of the vault
key sealed under a recovery code is sealed again under `k_wrap` with its own
associated data, the recovery proof is an HMAC like the auth key, a two-factor
TOTP secret is encrypted under its own derived key bound to the account id, and
backup codes are stored as HMACs.

As a result:

| An attacker holds                  | Can they test password guesses offline?                        |
| ---------------------------------- | -------------------------------------------------------------- |
| A copy of D1 and Durable Objects   | No. Nothing in it can be checked without `AT_REST_SECRET`.     |
| That copy and the Worker secrets   | Yes, at 600,000 or more PBKDF2-SHA256 iterations per guess.    |
| D1, secrets, and a master password | Yes: that vault is open. Nothing server-side can prevent this. |

The second row is the position of any password manager whose server loses
both its database and its keys. A strong master password is what holds there.

Login compares hashes in constant time, and performs the comparison even for
an unknown address, so response time does not reveal which emails exist.

## Why PBKDF2 and not Argon2id

Argon2id is the stronger function: memory-hard, so far more expensive to attack
on GPUs. Using it in a browser means shipping a WebAssembly implementation
inside the extension, and in software that holds every password its user owns,
each dependency is a place malicious code could be inserted. PBKDF2-SHA256 at
600,000 iterations is built into WebCrypto, needs nothing, and matches
[OWASP's recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Moving to Argon2id later is possible without breaking
existing vaults, because the KDF type is stored per account.

## Nonces

Every encryption draws a new 96-bit nonce from the system's random generator.
With random nonces, AES-GCM stays safe up to roughly 2³² encryptions under one
key. A vault of 5,000 items edited daily for decades stays many orders of
magnitude below that.

## 2FA codes

Codes follow [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) and are
computed offline:

```
counter = floor((unix_time + clock_offset) / period)
hmac    = HMAC(secret, counter as 8-byte big-endian)
offset  = hmac[last] & 0x0f
code    = (31-bit integer at offset) mod 10^digits
```

The default is HMAC-SHA1, as the RFC and nearly every site use. SHA-1's
weakness is collisions, which do not affect HMAC. Using SHA-256 where a site
expects SHA-1 would yield codes the site rejects. All 18 test vectors from the
RFC pass in `test/totp.test.ts`.

A wrong clock makes valid-looking codes that every site rejects, a failure
almost nobody diagnoses unaided. At unlock the extension reads `/api/time`,
stores the offset, applies it to every code, and warns when it exceeds ten
seconds.

## Password generation

Random values come from `crypto.getRandomValues`, never `Math.random`. Picking
from an alphabet uses rejection sampling, so no character is more likely than
another. Three modes: random characters, passphrases from the EFF short
wordlist, and PINs. Each reports its entropy in bits, computed from the actual
alphabet or wordlist size.
