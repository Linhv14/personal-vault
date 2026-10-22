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

The salt is the account's email followed by random bytes from the account's
KDF parameters. The email is trimmed and lowercased first: a stray capital or a
trailing space typed at sign-in would otherwise derive a different key and
lock the owner out of their own vault, a failure that is very hard to diagnose
from the symptom. The random part keeps two registrations of the same address
from producing the same key.

AES keys are imported with `extractable: false`, so a `CryptoKey` cannot be
exported back to bytes by any script that gets hold of it. The wrapping key in
particular exists only as such an object: its raw bytes are never stored, and a
script-injection bug in an extension page could use it while the page is open
but not copy it out.

A wrong master password is detected by the vault key failing to unwrap: the
AES-GCM tag does not verify, and the client reports `crypto.wrong_password`
without the server confirming anything. This is one reason for an
authenticated mode; AES-CBC would hand back garbage and let the application
treat it as a key.

The Worker also checks what clients send. A sealed value whose nonce is not
exactly 12 bytes is refused by the Worker, since it can only come from a broken
client or someone probing, and KDF parameters are accepted only between 600,000
and 5,000,000 iterations: the floor stops a client from downgrading itself into
brute-force range, and the ceiling stops anyone from locking themselves out
with a count that hangs the browser.

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

Under that keyed layer, the auth key is hashed with a single round of SHA-256.
A slow hash protects low-entropy input such as a password; the auth key is
already 32 uniformly random-looking bytes produced by 600,000 PBKDF2
iterations, so no dictionary reaches it and a slow hash would only spend Worker
CPU. Session, revoke and two-factor challenge tokens are 32 random bytes and
are stored as one SHA-256 round for the same reason: a leaked database yields
no token that can be replayed.

Sessions are looked up by the primary key on that hash, so the lookup needs no
constant-time comparison. Index lookup timing in SQLite says nothing useful,
and an attacker would have to guess all 32 bytes of a token before a single
lookup matched. Comparisons that do run on secret bytes, such as checking an
auth key hash, use a constant-time byte comparison: a plain string `===` stops
at the first difference, and that timing can recover a token one byte at a
time.

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

Details that are easy to get wrong:

- **Secrets are base32 as in RFC 4648 section 6**, the alphabet every site uses
  to show a setup key, not base32hex or Crockford's. Decoding is forgiving
  about what a person pastes: spaces and dashes are removed (sites often show
  `jbsw y3dp ehpk`), lowercase is accepted and padding is dropped. Leftover
  bits after the last full byte are padding and are discarded, as the RFC
  says.
- **The counter is a 64-bit big-endian integer**, written with `BigInt`. It
  only exceeds 32 bits in the year 6053, but JavaScript's bit shifts wrap at
  2³¹ and would break silently; a dedicated test pins this.
- **Dynamic truncation reads its offset from the last byte of the actual MAC**,
  so SHA-256 and SHA-512 secrets work as well as SHA-1, and the sign bit of the
  extracted integer is cleared.
- **Only TOTP is supported.** HOTP is counter-based and needs persisted state
  that increments on every use, so it cannot share the time-based path.
- **The `issuer` parameter of an `otpauth://` URI wins over the label prefix**
  (`Issuer:account`, possibly percent-encoded), as Google's key URI format
  recommends.
- **Typing, a QR scan and a pasted URI go through one parser**, which accepts
  either an `otpauth://` URI or a bare base32 secret, so the three entry paths
  behave identically.
- **New secrets are 20 bytes**, the key length RFC 4226 recommends for
  HMAC-SHA1, which encodes to 32 base32 characters.

A wrong clock makes valid-looking codes that every site rejects, a failure
almost nobody diagnoses unaided. At unlock the extension reads `/api/time`,
stores the offset, applies it to every code, and warns when it exceeds ten
seconds.

## Password generation

Random values come from `crypto.getRandomValues`, never `Math.random`, which
is not a cryptographic generator: its internal state can be recovered from a
handful of outputs, after which every password from the same context is
predictable. Picking from an alphabet uses rejection sampling. Taking a random
32-bit value modulo the alphabet size would make low values slightly more
likely whenever the size does not divide 2³², which quietly lowers the real
entropy; rejection sampling discards the values in that ragged tail so the rest
is exactly uniform. Shuffles are Fisher-Yates driven by the same function, so
they are unbiased too.

Three modes: random characters, passphrases from the EFF short wordlist, and
PINs. Each reports its entropy in bits, computed from the actual alphabet or
wordlist size, so swapping the alphabet or the list never makes the displayed
figure wrong.

- **Random characters include one from every selected set.** Many sites demand
  an uppercase letter, a digit and a symbol, and without the guarantee people
  would regenerate every few tries. The generator takes one mandatory character
  per set, fills the rest from the whole alphabet, then shuffles, which keeps
  every position uniformly random; without the shuffle the first characters
  would follow the order of the sets. The reported entropy is an upper bound,
  since the constraint narrows the space slightly; at 16 characters and above
  the difference is under one bit.
- **"Avoid ambiguous characters"** drops characters that are easily confused
  when a password is read aloud or retyped from another screen, such as `0`,
  `O`, `l`, `1` and brackets. It adds no security, only fewer mistakes.
- **Passphrases use the EFF short wordlist** of 1,296 words rather than the long
  list of 7,776. Each word carries 10.34 bits instead of 12.92, but the words
  are shorter and easier to type on a TV, a console or over the phone. The
  default is therefore 8 words, not the usual 5: five short words are 51.7
  bits, which the strength meter calls weak and offline brute force can reach,
  while eight give 82.7 bits, about a random 13-character password.

Strength is rated by entropy, not by rules such as "has an uppercase letter and
a digit": below 60 bits is weak, and 75 bits and above is out of reach of
present-day offline brute force.
