# Threat model

What 7key protects, against whom, and where the protection ends. The mechanisms
behind each claim are in [Cryptography](cryptography.md) and
[Teams and CI secrets](teams.md); the tests that enforce them are listed at the
end.

## Assets

1. **Vault contents:** site names, URLs, usernames, passwords, 2FA secrets,
   notes, cards and addresses.
2. **The master password**, which opens the vault on any device.
3. **The recovery code**, which can replace the master password.
4. **Team secrets:** team vault items and project secrets shared inside an
   organization, and the repository keys that let CI read them.
5. **Shared items**, while a link is alive.
6. **Metadata:** who has an account, how many items, when they sign in, who
   belongs to which organization.

## Parties

| Party                 | Assumed capability                                                   |
| --------------------- | -------------------------------------------------------------------- |
| Network attacker      | Reads and alters traffic outside TLS                                 |
| Server operator       | Reads D1 and Durable Object storage, changes Worker code and secrets |
| Database thief        | Holds a copy of D1 and of the Durable Objects' storage, nothing else |
| Malicious website     | Runs script in a page the user visits                                |
| Teammate              | A member of the same organization or team                            |
| Link carrier          | The chat or email service that transports a share link               |
| Breach-check service  | Have I Been Pwned, asked for password hash prefixes                  |
| Icon service          | DuckDuckGo or Google, asked by the Worker for logos                  |
| Device thief          | Holds a powered-off or locked device                                 |
| Malware on the device | Runs code as the user while the vault is unlocked                    |

## What each party can learn

| Party                | Vault contents                                                                                                    | Master password                                                             | Metadata                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Network attacker     | No: TLS, and the payload is ciphertext anyway                                                                     | No                                                                          | Timing and size of requests                                                    |
| Database thief       | No                                                                                                                | No offline guessing without `AT_REST_SECRET`                                | Emails, item counts, timestamps, organization membership, audit log with IPs   |
| Server operator      | No, as long as the extension is honest (see below)                                                                | Can guess offline at the account's PBKDF2 cost, at least 600,000 iterations | Everything the database holds, plus what Cloudflare records about each request |
| Malicious website    | A login the user fills there, only on its own domain; a card or address the user picks from the menu on that page | No                                                                          | Whether autofill is on                                                         |
| Teammate             | Everything in the teams they share, whose key every member holds                                                  | No                                                                          | Member list and roles; for admins, the activity log                            |
| Link carrier         | The shared item, unless a passphrase was set and sent separately                                                  | No                                                                          | That something was shared                                                      |
| Breach-check service | No: it receives 5-character SHA-1 prefixes, each shared by hundreds of passwords, with padded responses           | No                                                                          | The user's IP address and that a check ran                                     |
| Icon service         | No                                                                                                                | No                                                                          | Domain names, from the Worker's address, not the user's                        |
| Device thief         | With auto-lock on "Never", yes while the session is valid; otherwise no, the local copy is ciphertext             | Can guess offline against the cached wrapped key                            | Email, item count                                                              |
| Malware on device    | Yes, once unlocked                                                                                                | Yes, if it logs keystrokes                                                  | Yes                                                                            |

## What the server learns

The server, and so anyone who operates or breaches it, learns:

- each account's email address;
- how many items each account has, their approximate sizes, and when each one
  changed;
- when each session was created and last used, and a device label derived from
  the browser's User-Agent, such as "Chrome on macOS";
- whether two-factor authentication and a recovery code are set up;
- organization and team names, members and roles; project, environment and
  secret ids, counts and timestamps, but not their names or values;
- for each linked repository, its name, the branch or GitHub environment it is
  allowed from, and when it last read secrets;
- the organization activity log, which stores the IP address of each recorded
  action in the organization's Durable Object;
- that a share exists, its lifetime, view limit and whether it has been opened,
  but not who created it;
- addresses that requested a sign-up code or failed to sign in. Throttling and
  the per-network sign-up counter store keyed hashes of the address and IP, not
  the values.

Cloudflare sees the IP address of every request, and the Worker's logs, which
`wrangler.toml` turns on, are kept by Cloudflare.

With website icons on (the default), the server also sees the domain of each
saved login while it fetches that site's logo. The Worker keeps each logo in
Cloudflare's edge cache for up to 7 days, keyed by domain only, not by account;
the extension keeps fetched logos in memory only, never on disk. With the
option off, the server never learns site names. It never learns URLs,
usernames, passwords, 2FA secrets, notes, card numbers, or the contents of a
share.

## Exported files

An encrypted export is as strong as its passphrase: PBKDF2-SHA-256 with 600,000
iterations and AES-256-GCM, with a fresh salt per file. Anyone holding the file
can guess the passphrase offline at that cost, so 7key requires at least 10
characters. A CSV export is plain text and offers no protection once copied.

## Signing in

**Key derivation.** The master password goes through PBKDF2-SHA-256 on the
device. 600,000 iterations is the floor: the server refuses fewer when an
account is created and when its password is changed or recovered. An older
account with fewer iterations still signs in, and the client then re-wraps the
vault key at 600,000 iterations without asking.

**Master password policy.** A new master password must be 12 to 256
characters and must not equal the email address or its local part. On account
creation, on a password change and on recovery, the client also looks it up in
Have I Been Pwned with the same k-anonymity range query as the health check,
and refuses a password that appears in a breach. If the service cannot be
reached, that check is skipped rather than blocking the user. The server never
sees the password, so it cannot enforce any of this; a modified client can set
a weak one.

**Guessing.** Failed attempts are counted per address and network, the email
and the IP together. The first five failures cost nothing; each one after that
makes that pair wait twice as long as the last, from 5 seconds up to one hour.
Separately, after 20 failures within an hour against one address from
anywhere, every attempt on that address is slowed by 250 ms, doubling every
five failures up to 5 seconds. There is never a hard lock, so an attacker
guessing from one network cannot lock the owner out from another. Recovery
codes and two-factor codes are throttled the same way with their own counters;
the code asked for at sign-in shares the password's counters. Sign-in, sign-up,
recovery and share endpoints are also limited to 30 requests per minute per IP,
and sign-up requests to 10.

**Which addresses have accounts.** `prelogin` returns stable, plausible KDF
parameters for unknown addresses. Login runs the same keyed comparison whether
or not the address exists. On a server without email, signing up with a taken
address returns a decoy `201` with a token that is not stored anywhere, and
changes nothing. On a server with email, sign-up needs a code sent to the
address, and an address that already has an account receives a "you already
have an account" email instead of a code, so only someone who reads that inbox
learns anything. Endpoints that must give the same answer either way (sign-up
codes and share access codes) look up the address and send the email after
responding, in `waitUntil`, so their timing does not depend on whether the
address exists.

**Bots.** When Turnstile is configured, account creation, sign-up codes, the
first two recovery steps and share access codes need a valid token, checked
against the server's own hostnames. Sign-in, share reads and opening a share
with a code are not behind it. Without Turnstile configured, nothing changes.

**Sessions.** Session tokens are 32 random bytes sent as a bearer header, never
a cookie; the server stores their SHA-256. A session ends after 14 days without
use or 30 days after it was created, whichever comes first, and an account
keeps at most 20. Settings lists the active sessions with their device label
and last use, and revokes any one of them or all the others. Signing in with a
device label the account has not used before sends an email, when the server
can send email. Changing the password signs out every session, or every other
session when the client asks to keep its own.

## Account two-factor authentication

An account can require a TOTP code (SHA-1, 6 digits, 30 seconds, one step of
drift either way) at sign-in. Turning it on needs the master password and a
working code, and signs out every other session. Ten single-use backup codes
come with it.

- The TOTP secret is encrypted at rest under a key derived from
  `AT_REST_SECRET`, bound to the account id; backup codes are stored as HMACs.
- A correct password returns only a challenge token, stored as a hash, valid
  for five minutes, single use, and discarded after five wrong codes. The
  session and the wrapped vault key are released only after the code checks
  out. Wrong passwords answer exactly as without 2FA.
- A TOTP code is accepted once: the server remembers the last time step used
  and refuses it and anything earlier.
- Turning 2FA off or replacing the backup codes needs the master password and a
  current code. The owner is emailed when 2FA is turned on or off.

Limits: there is no "remember this device", so every sign-in asks. 2FA guards
sign-in only. PIN and biometric unlock reopen an existing session and never ask
for a code. Changing the master password, deleting the account and creating a
recovery code need the master password, not a code. Using a recovery code
turns 2FA off. 2FA does nothing against a server operator or a database thief:
it is not part of any key.

## Forgotten master password

Nobody holds a copy of the master password, and the server cannot reset it.
The only way back in is a recovery code created beforehand in Settings. Without
one, a forgotten master password means the vault is lost.

A recovery code is 160 random bits. The device derives two keys from it with
HKDF: one seals the vault key, the other proves to the server that the user
holds the code. The server stores the sealed vault key, sealed again under a
key derived from `AT_REST_SECRET` and bound to the account, and an HMAC of the
proof. Neither opens the vault, and 160 bits cannot be guessed offline, even by
someone who also holds the Worker's secrets.

Resetting needs the code and, when the server can send email, a 6-digit code
sent to the account's address, so a stolen recovery code alone is not enough
there. A server without email accepts the recovery code alone. A reset sets a
new master password and a new recovery code in one step, so the code used stops
working; it signs out every session, turns two-factor authentication off and
deletes the backup codes, and emails the owner that the account was recovered
and, separately, that 2FA was turned off. Recovery attempts are throttled like
sign-in and answer an unknown address the same as a wrong code.

A recovery code is a second way in. Whoever holds it, and can read the
account's email where the server sends email, owns the vault.

## Integrity of stored items

Each personal item is sealed with AES-256-GCM under the vault key, with
`personal-vault/item/<id>` as associated data, so the server cannot move one
item's ciphertext into another item's row. The account id is not part of an
item's associated data. It binds the server-side layer on the wrapped vault
key (`personal-vault/wrapped-vault-key/<account>`), so wrapped keys cannot be
moved between accounts; items of different accounts are under different vault
keys in any case.

Items written by early versions carried no associated data. The extension
still opens those until it has rewritten them in the bound form; it then
records, per server and account, that this device has migrated, and from then
on refuses unbound ciphertext, also after signing out and back in. A device
that has not yet migrated this account, such as a new one or one whose storage
was cleared, accepts unbound items until its first migration, which runs on
the first sync after unlock. During that window a malicious server could serve
an old unbound ciphertext under another item's id, as long as the item inside
names no id or the same id.

## Share links

A share link's fragment is its key; the server stores ciphertext only, and the
recipient page decrypts locally. Secret fields, the password and hidden custom
fields, are shown masked. Pressing reveal places the value in the page, and it
is masked again after 30 seconds or as soon as the tab is hidden. Copy works
without revealing. The username, website, visible custom fields and, when the
sender included it, the note are shown in clear. The note is left out unless
the sender ticks it.

The Worker serves the page with its own Content Security Policy
(`default-src 'none'`, scripts only from the page's origin and Turnstile,
`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `no-referrer` and HSTS.
See [Share links](share-links.md) for lifetimes, view limits and recipient
restrictions.

## Malicious websites and autofill

Autofill is off until the user grants the extension access to sites. The page
script is treated as untrusted; the service worker decides, using the sender
details Chrome reports.

- **Logins** are suggested and filled only in the top frame, only on https
  (http only on localhost), never on the vault's own server, and only when the
  login matches the registrable domain of the URL Chrome reports for that
  frame. Suggestions carry titles and usernames; a password leaves the service
  worker only for the login clicked. Every action needs an event with
  `isTrusted` set, and the menu lives in a closed shadow root.
- **Cards and addresses** are not tied to a domain. They are offered in the
  top frame of any https page except the vault's own server, and filled only
  after the user picks one with a trusted click. A malicious page receives
  whatever card or address the user chooses to fill into it, as it would if
  the user typed it.
- **Payment iframes.** Many checkouts put card fields in a payment provider's
  iframe. A small script runs in every frame, but the service worker registers
  a frame only when its URL is https on a short allowlist of hosted card field
  origins (`src/core/payment-frames.ts`: Shopify, Stripe, Braintree, Square,
  Mollie, Authorize.net) and the top page is https. A filled card is sent only
  to frames registered that way, addressed by the document id Chrome assigned
  at registration, so a frame that has since navigated elsewhere does not
  receive it.
- **Saving typed cards and addresses.** When the user submits a card or an
  address they typed, the extension asks whether to save it; it never saves
  without that answer. A card the extension filled itself is not offered. The
  security code is saved only when the user ticks the box. Nothing is offered on
  plain http, and "never" stops the question on that site.
- **Lookalike domains.** When a page's domain resembles the domain of a saved
  login (an internationalized homograph, confusable characters such as `rn`
  for `m`, a saved brand used as a subdomain or a hyphenated part of another
  domain, or a one-character typo), the in-page menu and the popup warn and
  name the saved domain. The comparison runs on the device against the saved
  logins; nothing is sent anywhere.

## Organizations and teams

Each account has an ECDH P-256 key pair whose private key is sealed under the
vault key. A team key is wrapped for each member's public key; project keys and
team vault items are sealed under the team key, with associated data naming
the team, the key generation and the object.

- **The server distributes public keys.** A malicious server could give an
  admin its own key in place of a new member's and receive the team key wrapped
  for itself. The defence is manual: the console shows each person's key
  fingerprint, and the admin compares it with that person out of band before
  granting access. A public key, once set, cannot be replaced through the API.
- **Re-keying after a removal is manual.** Removing someone flags the team, and
  the server refuses writes to its projects and vault until an admin who is in
  the team generates a new key on their device and re-encrypts everything.
  Anything the removed person read or copied before stays readable to them.
- **View-only access and protected environments are enforced by the server,
  not by cryptography.** Every team member holds the team key, because reading
  needs it. The organization's Durable Object refuses writes from a view-only
  member, and from a non-admin in a protected environment; it cannot stop
  either from reading everything in the team. Put secrets that someone must not
  read in a team they are not in.
- **Within one key generation the server can roll back.** It can serve an older
  copy of a team item or secret, or withhold a deletion; it cannot alter or
  invent one. The popup ignores a team key generation older than the newest it
  has seen.

## Single sign-on

With SSO an organization adds its identity provider (IdP) to the parties the
server trusts, for sign-in only:

- **The IdP can sign members in, not decrypt them.** A valid ID token gets a
  session and the member's wrapped vault key, exactly what a correct password
  gets today. Opening that key still needs the master password, which never
  leaves the device, so a compromised or malicious IdP, or a stolen IdP account,
  can read nothing it could not already read with a stolen 7key password. It can
  create accounts for new addresses on the organization's verified domains and
  join them to the organization as members.
- **The IdP replaces 7key two-factor authentication for SSO sign-ins**, as in
  Bitwarden: a member with 2FA who signs in through SSO is not asked for a code,
  because the organization's IdP is where it enforces MFA. Password sign-in
  still asks for the code.
- **Which IdP a member trusts is set by the organization's owners and admins.**
  An admin can point the organization at an IdP they control and sign in as
  anyone whose email is on one of the organization's verified domains, whether
  or not they are a member. They would still need that
  member's master password to read the member's vault, and anything they
  already have access to as an admin is shared with them anyway.
- **Domains are claimed with DNS.** Only an organization that published
  `7key-verify=<token>` in the domain's TXT records, checked over Cloudflare's
  DNS over HTTPS, can serve SSO for addresses on it, and only one organization
  can hold a domain. Someone who controls the domain's DNS can claim it. An
  address on another domain never signs in through SSO, even if it is invited or
  already a member: an invitation is something the admin issues alone, so it
  cannot stand for the person's consent to trust the admin's IdP.
- **The flow resists the usual OIDC attacks.** The Worker uses PKCE (`S256`)
  with the IdP, a one-time `state` that expires after ten minutes and a `nonce`
  checked in the ID token; it verifies the ID token's signature (RS256 or
  ES256) against the IdP's published keys, its issuer, audience (`azp` when
  there are several), expiry and issue time, and requires `email_verified`
  (`xms_edov` for Microsoft Entra ID). The redirect URI is fixed, and the result
  goes only to the web app or an allowed extension, never to an address taken
  from the request. The grant in that redirect is single-use, lives two
  minutes and can only be redeemed with a verifier that the client that started
  the attempt kept, so a grant leaked from a URL is useless on its own.
- **Server-held secrets.** The IdP client secret and each pending PKCE verifier
  are encrypted with `AT_REST_SECRET`. Discovery documents and key sets are
  fetched with a five-second timeout and a 64 KB cap, over https only and
  without following redirects.
- **Policies are enforced by the server.** Require SSO refuses password
  sign-in to members on a verified domain other than owners and admins, who keep it so a broken IdP
  cannot lock the organization out. Single organization refuses invitations.
  Neither revokes sessions that already exist.

## Audit log

Each organization's Durable Object appends an event for every recorded action
(who, what, which object, when, and the client's IP) and chains each record to
the previous one with SHA-256. Deleting or editing a record breaks every later
hash, and the log view reports whether a page verifies.

The chain is not keyed and is stored by the operator. It reveals accidents and
an outsider who can change rows but not recompute hashes. An operator, or
anyone who controls the Worker, can rewrite the log and recompute the chain.
Some events, such as revealing or copying a secret in the console, are reported
by the client: they record what an honest client did, not what a member could
do with the key they hold.

## CI and the GitHub Action

A linked repository has its own key pair. The environment key is wrapped for
the repository's public key; the private key (`SEVENKEY_KEY`) is shown once and
kept as a GitHub secret. To read secrets, the CLI or the Action requests a
GitHub OIDC token whose audience is the 7key server. The server checks its
signature against GitHub's published keys, its issuer, audience and expiry,
then the link's rule: the exact repository and the exact branch or GitHub
environment, never `pull_request_target`. Only then does it return the wrapped
key and the sealed secrets, and it records `ci.read` with the repository, ref
and IP.

The server learns which repository read which environment, from where and
when; it never sees the values. Neither half is enough alone: the repository
key without a matching OIDC token gets nothing from the server, and the
server's response is useless without the repository key. In the job, the
Action masks secret values in the log and writes them to `GITHUB_ENV`, so every
later step of that job can read them. A compromised action in the job is a
compromised secret.

## The CLI

The `7key` CLI signs in with the master password, and a 2FA code when it is
on, and keeps the session token and the account's private key, which opens
every team key the account holds. It stores them in the macOS Keychain or, on
Linux, the Secret Service keyring. Without a system keyring it refuses to keep
them, unless the user passes `--insecure-file-store` or sets
`SEVENKEY_INSECURE_FILE_STORE=1` or `SEVENKEY_KEYRING=file`; the file is then
written with mode 600 and a warning. Anyone who can read that keyring entry or
file as the user can use the session and the team keys until the session ends.

## `7key agent`

`7key agent -- <command>` runs a command, typically an AI coding agent, with
secrets it can use but not read.

- Each secret gets a random placeholder (`7key-ph-` and 24 hex characters) in
  the child's environment. Variables, which are not secret, are passed as plain
  values. Secrets with no allowed hosts, or shorter than 8 characters, are not
  passed at all.
- The child's HTTPS traffic goes through a proxy on `127.0.0.1` that requires a
  random password, carried in the proxy URL in the child's environment. For a
  host on a secret's allowlist, the proxy terminates TLS with a certificate
  from a certificate authority created for this run, valid for two days, whose
  private key stays in memory. Only the child trusts it, through its
  environment (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and similar); the
  certificate files are deleted when the command exits. Other hosts are
  tunnelled untouched.
- Placeholders are replaced with real values only in request headers,
  including inside Basic authorization, and only for a host allowed for that
  secret. URLs and bodies are left alone, so an echoing endpoint cannot be
  asked to transform a value.
- Responses from intercepted hosts are scrubbed: the raw value and its base64,
  base64url, percent-encoded, JSON-escaped and hex forms are replaced with the
  placeholder, across chunk boundaries and after decompression.

Limits: any process that inherits the child's environment can use the proxy,
and so can send authenticated requests to the allowed hosts while the command
runs. The scrubber covers the encodings above, not every transformation; an
allowed host that returns a secret in another form, reversed or encrypted for
example, defeats it. Allow only the real API hosts for each secret.

## Trash

An item moved to the trash keeps the trash date inside its encrypted record, so
the server cannot tell a trashed item from a live one. Thirty days later the
extension deletes trashed personal items on its next sync while unlocked; until
a device does that, the ciphertext stays on the server. Team vault items are
not purged automatically.

## Transport and headers

API responses and the share page carry `Strict-Transport-Security` with a
two-year `max-age` and `includeSubDomains`, `X-Content-Type-Options: nosniff`
and `Referrer-Policy: no-referrer`. The API answers cross-origin requests only
from extension origins. The web dashboard at `/app` has a Content Security
Policy that allows connections only to its own origin and the breach-check
service. `/.well-known/security.txt` publishes the security contact
(`security@7key.online` unless the operator sets another) and links to
[SECURITY.md](../../SECURITY.md). Public pages are also served as Markdown to
clients that ask for `text/markdown`; the HTML responses keep their security
headers, and the Markdown response is plain text with `nosniff`.

## Out of reach, by design

**A forgotten master password without a recovery code.** Nothing can unwrap
the vault key. A recovery code is the one deliberate second way in, open to
whoever holds it.

**Malware on an unlocked device.** Code running as the user can read the
extension's memory, the screen and the keyboard. No client-side design survives
a compromised endpoint. The same holds for the CLI's keyring entry and for any
process running under `7key agent`.

**The link carrier.** A share link's fragment is its key. The service that
carries the link can read it like any other text. A passphrase delivered over
a different channel closes this, at the cost of a second message.

**A malicious server and an honest-looking extension update.** The extension's
code decides what it sends. An operator who also ships the extension can ship
one that sends keys home. Self-hosting from source you have read, or building
the extension yourself, is the defence. A Chrome Web Store build is only as
trustworthy as its publisher.

**A malicious server and the web dashboard.** The dashboard at `/app` is code the
server sends on every visit. An operator, or anyone who takes over the server,
can send a version that leaks the master password or keys of whoever signs in
next. Only organization admins need the dashboard; the extension covers the
same tasks without this exposure.

**A malicious server and public keys.** The server can substitute a public key
when someone is added to a team. Only comparing fingerprints out of band
catches it.

**Teammates.** Everyone in a team can read everything in it. Roles limit
writes, not reads.

**Server-side rollback.** A server can return an older copy of an item, or
withhold a newer one; the extension cannot tell. Integrity of each item is
protected, freshness of the whole vault is not.

**Metadata.** The list above is accepted for a password manager. If hiding who
uses the server, or when, matters to you, this design is not enough.

## Known gaps

- **No independent audit.** The project has not had one.
- **No bug bounty yet.** Reports go to the contact in
  `/.well-known/security.txt` (`security@7key.online`) or as described in
  [SECURITY.md](../../SECURITY.md).
- **No Argon2id.** PBKDF2-SHA-256 is kept so `src/core` stays free of
  dependencies and uses only WebCrypto; it is not memory-hard. See
  [Cryptography](cryptography.md).
- **The audit log is not operator-proof.** Its hash chain is unkeyed and stored
  by the operator.
- **Freshness is not protected.** The server can roll back items or withhold
  changes; for team data, within one key generation.
- **Metadata is visible to the server**, as listed above.

## Specific defences

| Threat                                                     | Defence                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login request reveals the vault key                        | Auth key and wrapping key are separate HKDF outputs                                                                                                                                                                                                                                                |
| Leaked database used to guess passwords                    | Auth hash and wrapped key keyed by `AT_REST_SECRET`, which is not in the database                                                                                                                                                                                                                  |
| Weak key derivation                                        | At least 600,000 PBKDF2 iterations; older accounts are re-wrapped at their next sign-in                                                                                                                                                                                                            |
| Weak or breached master password                           | 12 to 256 characters, not the email address, refused when Have I Been Pwned lists it (skipped when unreachable); enforced by the client                                                                                                                                                            |
| Online password guessing                                   | Per address and network: five free failures, then waits doubling from 5 seconds to one hour; per address: a slowdown of up to 5 seconds after 20 failures in an hour; never a hard lock; 30 requests per minute per IP                                                                             |
| Stolen master password                                     | Optional TOTP with replay protection and single-use backup codes; an email on sign-in from a new device label                                                                                                                                                                                      |
| Finding out which emails have accounts                     | Stable decoy `prelogin` parameters; the same comparison at login for unknown addresses; a decoy `201` for a duplicate sign-up, or a different email when the server sends email; same-answer lookups run after the response                                                                        |
| Bots on sign-up, recovery and share codes                  | Turnstile, when configured                                                                                                                                                                                                                                                                         |
| Strangers using a personal server                          | Account creation needs `REGISTRATION_TOKEN` unless open registration is chosen or the address holds an invitation                                                                                                                                                                                  |
| Flooding a shared server                                   | Per-network daily account limit, per-account item and write limits                                                                                                                                                                                                                                 |
| Server swaps ciphertext between items                      | Item id is AES-GCM associated data; a device that has migrated refuses unbound legacy items                                                                                                                                                                                                        |
| Server swaps wrapped keys between accounts                 | Account id is associated data of the server-side layer on the wrapped vault key and on the recovery copy                                                                                                                                                                                           |
| Stolen session token replaces the password                 | Changing the password, deleting the account, and managing 2FA or the recovery code need the current auth key                                                                                                                                                                                       |
| Stolen session token survives a password change            | Changing the password revokes the other sessions; sessions also end after 14 idle days or 30 days, and can be revoked from Settings                                                                                                                                                                |
| Leaked database yields usable tokens                       | Only SHA-256 hashes of session, revoke and 2FA challenge tokens are stored                                                                                                                                                                                                                         |
| Stolen recovery code                                       | Resetting also needs a code emailed to the account when the server sends email; attempts are throttled; the owner is emailed                                                                                                                                                                       |
| Two people opening a single-view link at once              | The view is claimed in one conditional `UPDATE … RETURNING`                                                                                                                                                                                                                                        |
| Probing a share's recipient list                           | Requesting a code returns the same answer for every address, and the lookup runs after the response                                                                                                                                                                                                |
| A page impersonating another site to autofill              | The service worker uses the URL Chrome reports for the sender's top frame                                                                                                                                                                                                                          |
| A page clicking autofill on the user's behalf              | Every action requires a trusted user event; the UI is in a closed shadow root                                                                                                                                                                                                                      |
| A frame posing as a payment field                          | Card data goes only to frames on the payment-provider allowlist, on an https page, addressed by document id                                                                                                                                                                                        |
| Phishing on a lookalike domain                             | Logins never fill there; a local warning names the saved domain it resembles                                                                                                                                                                                                                       |
| A page using another site's passkey                        | The RP ID is checked against the top-frame origin Chrome reports, no broader than its registrable domain; `clientDataJSON` carries the real origin                                                                                                                                                 |
| Copied password left on the clipboard                      | Cleared after 30 seconds by the service worker, even after the popup closes                                                                                                                                                                                                                        |
| Vault key written to disk                                  | Only sealed under a key the server holds per session, and only with auto-lock on "Never"; deleted on lock, sign-out or a revoked session                                                                                                                                                           |
| PIN guessed on a stolen laptop                             | The sealed vault key needs both the PIN and a key the server releases only for the right PIN; five wrong tries wipe it, and the session ending, sign-out or a password change ends it too                                                                                                          |
| Biometric unlock replayed or forged                        | The server releases the key only for a signature over a fresh one-time challenge from the key pair the platform authenticator created, with user verification; the sealed copy also needs a secret that stays on the device                                                                        |
| A copied session token while PIN or biometric unlock is on | The token stays on disk while the vault is locked, so a copy of the browser profile can call the API until the session ends: list, delete or roll back items to older ciphertext from the same disk. It cannot read anything or unlock the vault, and signing out or changing the password ends it |
| Script injection or framing on the share page              | Strict CSP set by the Worker, `frame-ancestors 'none'`; a revealed secret is masked again after 30 seconds or when the tab is hidden                                                                                                                                                               |
| Removed team member reads new secrets                      | The team is flagged and writes are refused until an admin re-keys it                                                                                                                                                                                                                               |
| CI secrets read by another repository or a fork            | OIDC token checked for signature, issuer, audience and expiry; exact repository and branch or environment; `pull_request_target` refused; the values still need the repository key                                                                                                                 |
| CLI session left in a readable file                        | OS keyring only, unless the user opts in to a mode-600 file                                                                                                                                                                                                                                        |
| An AI agent reading the secrets it uses                    | `7key agent` gives it placeholders, swaps them only in headers to allowed hosts, and scrubs encoded copies from responses                                                                                                                                                                          |
| Supply-chain attack through dependencies                   | No dependencies in `src/core`; QR codes read with the browser's built-in `BarcodeDetector`                                                                                                                                                                                                         |

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
- `test/worker-auth.test.ts`: backoff per address and network, the capped
  per-account slowdown, and the owner never locked out; recovery throttled
  separately; the 600,000-iteration floor and the upgrade of older accounts;
  the same answers for duplicate sign-ups, unknown addresses and recovery.
- `test/worker-two-factor.test.ts`: setup needs the password and a code; the
  secret is encrypted and backup codes hashed at rest; no session or vault key
  before the code; used codes are refused; challenges expire and burn after
  five wrong codes.
- `test/master-password.test.ts`: length limits, the email check, the breach
  check sending only a 5-character prefix, and failing open when the service is
  unreachable.
- `test/account-recovery.test.ts` and `test/e2e-recovery.test.ts`: recovery
  codes are 160 random bits and open only the vault key they sealed, the server
  receives an auth key that cannot open it, and a code works once.
- `test/popup.test.ts`: the vault key reaches `storage.session` and only a
  sealed copy reaches `storage.local`, which a revoked session or "Lock now"
  deletes; no plaintext appears in any request.
- `test/autofill.test.ts`: suggestions carry no secrets; only matching domains
  are filled; shared-hosting tenants are kept apart.
- `test/payment-frames.test.ts` and `test/card-frames.test.ts`: only https
  frames of allowlisted providers on https pages are registered, and a card goes
  only to the registered document.
- `test/form-save.test.ts`: typed cards and addresses are offered for saving,
  never saved silently, the CVV only when ticked.
- `test/lookalike.test.ts`: homographs, confusables, embedded brands and typos
  are flagged; the saved site and its subdomains are not.
- `test/share-reveal.test.ts`: a revealed secret hides after 30 seconds or when
  the tab is hidden.
- `test/turnstile.test.ts`: protected endpoints fail closed when the check
  fails or cannot run, and tokens for another hostname are refused.
- `test/agent.test.ts`: placeholders are swapped only for allowed hosts and only
  in headers; real values are scrubbed from responses, encoded or not.
- `test/cli-credentials.test.ts`: the CLI refuses a plain session file unless
  the user opts in.
- `test/trash.test.ts`: personal items are purged 30 days after trashing.
- `test/e2e.test.ts`, against a real Worker and D1: no plaintext in any
  response, and a fresh client with only email and master password recovers
  the vault.
- `test/totp.test.ts`: all 18 RFC 6238 vectors.

The project has not had an independent security audit.
