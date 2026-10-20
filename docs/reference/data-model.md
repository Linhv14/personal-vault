# Data model

The D1 database `vault`, built by the files in [`migrations/`](../../migrations).
The last column of each table says what someone holding a copy of the database
learns from it.

"Keyed hash" means HMAC-SHA256 under `EMAIL_PROBE_SECRET`, base64 encoded:
without the secret, the original value cannot be confirmed by guessing.

## `accounts`

| Column                | Content                                                                                                             | Reveals                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `id`                  | Random UUID                                                                                                         | Nothing                       |
| `email`               | Normalized address, unique                                                                                          | **The address, in clear**     |
| `kdf_type`            | `pbkdf2-sha256`                                                                                                     | Nothing                       |
| `kdf_iterations`      | Iteration count                                                                                                     | Nothing                       |
| `kdf_salt`            | Random salt, base64                                                                                                 | Nothing                       |
| `auth_key_hash`       | `v2:` + HMAC of the auth key under a key derived from `AT_REST_SECRET`                                              | Nothing without the secret    |
| `wrapped_vault_key`   | `v2:` + vault key wrapped by the client, sealed again under `AT_REST_SECRET` with the account id as associated data | Nothing without the secret    |
| `wrap_nonce`          | Nonce of the client-side wrap                                                                                       | Nothing                       |
| `created_at`          | Unix seconds                                                                                                        | Sign-up time                  |
| `public_key`          | The account's ECDH P-256 public key, base64 SPKI                                                                    | Nothing beyond the key itself |
| `wrapped_private_key` | Its private key, sealed by the client under the vault key                                                           | Nothing                       |
| `identity_created_at` | Unix seconds                                                                                                        | When the key pair was made    |

Values without the `v2:` prefix come from before 0.2.0 and are rewritten on
the account's next login.

## Vault items: one Durable Object per account

Each account's items live in its own SQLite-backed Durable Object, named
`user:<accountId>` (class `UserStore`), not in D1. Its `items` table:

| Column       | Content                                                  | Reveals              |
| ------------ | -------------------------------------------------------- | -------------------- |
| `id`         | UUID chosen by the client                                | Nothing              |
| `ciphertext` | Whole item sealed under the vault key, `''` once deleted | Approximate size     |
| `nonce`      | AES-GCM nonce, `''` once deleted                         | Nothing              |
| `updated_at` | Unix seconds                                             | When it last changed |
| `deleted_at` | Unix seconds, or null                                    | When it was deleted  |

A `meta` table records the owning account, checked on every call, and how many
rows were copied from D1. Deleted rows stay as tombstones so offline devices
learn about the deletion; the whole object is erased with the account.

The D1 `items` table is the store from before 0.3.0. On an account's first
request after the upgrade its rows are copied into the object once; from then
on nothing reads or writes them, and they are deleted with the account.

### Inside `ciphertext`

The sealed item is a JSON object. The server never sees it; the fields below
are what every client reads after decrypting.

| Field                                                                | Types                              | Content                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`, `title`                                                        | all                                | Same id as the row; the name shown in lists                                                                      |
| `type`                                                               | all                                | `login`, `note`, `card`, `identity`, `recovery`, `wifi`, `api`, `ssh`, `bank`, `document` or `license`           |
| `createdAt`, `updatedAt`                                             | all                                | Unix seconds                                                                                                     |
| `vault`                                                              | all                                | Id of the vault holding the item; absent means the personal vault                                                |
| `favorite`                                                           | all                                | Whether the item is pinned to Favorites                                                                          |
| `tags`                                                               | all                                | Optional list of user-defined labels                                                                             |
| `trashedAt`                                                          | all                                | Unix seconds when the item was moved to Trash; absent for live items                                             |
| `note`                                                               | all                                | Free text                                                                                                        |
| `fields`                                                             | all                                | Custom fields: `{ label, value, hidden? }`                                                                       |
| `url`, `username`                                                    | login, api                         | Website (host for an API key) and user name or key id                                                            |
| `urls`                                                               | login                              | Further websites the login is offered on                                                                         |
| `urlMatch`                                                           | login                              | `host` to offer it only on the exact host; otherwise the whole site                                              |
| `password`                                                           | login, wifi, api, ssh              | Password, API secret or key passphrase                                                                           |
| `passwordHistory`                                                    | login, wifi, api                   | Up to 10 replaced passwords: `{ password, changedAt }`, newest first                                             |
| `totp`                                                               | login                              | `{ secret, algorithm, digits, period, issuer? }`                                                                 |
| `passkey`                                                            | login                              | Private key and metadata, see [Passkeys](../explanation/passkeys.md)                                             |
| `lastUsedAt`                                                         | login                              | Unix seconds of the last fill or passkey sign-in on a website, recorded at most once a minute; sorts suggestions |
| `cardholder`, `cardNumber`, `cardExpiry`, `cardCvv`, `cardPin`       | card                               | Name, digits only, `MM/YY`, security code, PIN                                                                   |
| `fullName`                                                           | identity, bank, document, license  | Person's or account holder's name                                                                                |
| `email`, `phone`, `company`                                          | identity (`email` also license)    | Contact details                                                                                                  |
| `address`, `ward`, `city`, `region`, `postalCode`, `country`         | identity (`country` also document) | Postal address; `ward` is the ward or commune, `city` the city or district                                       |
| `codes`                                                              | recovery                           | Array of one-time recovery codes                                                                                 |
| `usedCodes`                                                          | recovery                           | Codes from `codes` marked as used                                                                                |
| `ssid`                                                               | wifi                               | Network name                                                                                                     |
| `sshPublicKey`, `sshPrivateKey`, `sshFingerprint`                    | ssh                                | Key pair and fingerprint                                                                                         |
| `bankName`, `accountNumber`, `routingNumber`, `swift`, `iban`, `pin` | bank                               | Account details                                                                                                  |
| `documentKind`, `documentNumber`, `issuedOn`, `issuer`               | document                           | Passport, ID card or licence details                                                                             |
| `expiresOn`                                                          | api, document, license             | Expiry date as written                                                                                           |
| `licenseKey`, `version`                                              | license                            | Software licence key and version                                                                                 |

An item without `type` is a login, or a note when it holds nothing but a
title and a note: items saved before types existed keep working without a
migration. Empty fields are left out. Editing an item keeps
the fields the editor does not show. Extensions older than item types edit
every item as a login and drop the other fields, so update every device before
editing a card, address or other typed item.

One item per account carries `system: "vaults"` and a `vaults` array of
`{ id, name, color, icon }` instead of user data. It is encrypted and synced like
any item, so the server never sees vault names, and it is left out of every
list, search, autofill and import. When two devices write it at once, the
popup merges both by vault id and keeps the newest definition.

The normal decrypted list and autofill paths exclude items with `trashedAt`.
The popup and **Settings → Trash** request trashed items explicitly so they can
be restored or deleted forever; deleting forever is the server tombstone delete.

The server cannot read `trashedAt`, so the 30-day retention
(`TRASH_RETENTION_DAYS` in `extension/lib/trash.ts`) is enforced by the client.
After the popup unlocks and a sync succeeds, it deletes forever every personal
item trashed more than 30 days earlier, through the same tombstone delete.
Items in team vaults are never purged automatically. A purge that fails part way
stops and resumes after the next sync; running it again finds nothing new to do.

## `sessions`

| Column                                              | Content                                                             | Reveals                                          |
| --------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| `token_hash`                                        | SHA-256 of the bearer token                                         | Nothing usable                                   |
| `account_id`                                        | Owner                                                               | Number of signed-in devices                      |
| `created_at`                                        | Unix seconds                                                        | Sign-in times                                    |
| `expires_at`                                        | Unix seconds                                                        | Nothing                                          |
| `resume_key`                                        | Random key for this session                                         | Nothing without the device                       |
| `pin_verifier`                                      | Keyed hash of the PIN verifier                                      | Nothing; the PIN needs the device's salt to test |
| `pin_key`                                           | Random key, released for the right verifier                         | Nothing without the device                       |
| `pin_attempts`                                      | Wrong PIN tries since the last right one                            | Failed unlocks                                   |
| `bio_credential`, `bio_public_key`, `bio_algorithm` | The platform authenticator's credential id and public key           | That this device uses Touch ID or Windows Hello  |
| `bio_rp_id`, `bio_origin`                           | The extension's id and origin                                       | The extension build in use                       |
| `bio_key`                                           | Random key, released for a valid signature                          | Nothing without the device                       |
| `bio_challenge`, `bio_challenge_expires`            | Open one-time challenges, JSON `[{ value, expires }]`, at most five | When an unlock was attempted                     |

## `shares`

| Column        | Content                                 | Reveals                     |
| ------------- | --------------------------------------- | --------------------------- |
| `id`          | 16 random bytes, base64url              | Nothing                     |
| `ciphertext`  | Share payload sealed under the link key | Approximate size            |
| `nonce`       | AES-GCM nonce                           | Nothing                     |
| `expires_at`  | Unix seconds                            | Lifetime                    |
| `max_views`   | 1 – 100, or 0 for no limit              | View limit                  |
| `view_count`  | Views spent                             | Whether it was opened       |
| `created_at`  | Unix seconds                            | Creation time               |
| `revoke_hash` | SHA-256 of the revoke token             | Nothing usable              |
| `restricted`  | 1 when limited to recipients            | Whether recipients were set |

There is no account column: the database does not record who shared what.

## `share_recipients`

| Column       | Content                   | Reveals                    |
| ------------ | ------------------------- | -------------------------- |
| `share_id`   | Share                     | Number of recipients       |
| `email_hash` | Keyed hash of the address | Nothing without the secret |

## `share_codes` and `email_verifications`

Pending one-time codes for opening a restricted share and for sign-up.

| Column                   | Content                                               | Reveals                              |
| ------------------------ | ----------------------------------------------------- | ------------------------------------ |
| `share_id`, `email_hash` | Share and keyed hash of the recipient (`share_codes`) | Nothing without the secret           |
| `email`                  | Address being verified (`email_verifications`)        | **An address that tried to sign up** |
| `code_hash`              | Keyed hash of the code                                | Nothing without the secret           |
| `expires_at`, `sent_at`  | Unix seconds                                          | When a code was requested            |
| `attempts`               | Wrong guesses so far                                  | Nothing                              |

## `login_attempts`

| Column         | Content                        | Reveals                                        |
| -------------- | ------------------------------ | ---------------------------------------------- |
| `email`        | Address that failed to sign in | **Addresses someone tried**, registered or not |
| `failures`     | Count in the current window    | Guessing activity                              |
| `window_start` | Unix seconds                   | When                                           |
| `locked_until` | Unix seconds, or null          | Whether the address is locked                  |

## `registration_counts`

| Column    | Content                                  | Reveals                    |
| --------- | ---------------------------------------- | -------------------------- |
| `ip_hash` | Keyed hash of the client IP              | Nothing without the secret |
| `day`     | Days since the Unix epoch                | Nothing                    |
| `count`   | Accounts created from that network today | Sign-up volume             |

## Retention

The hourly cron deletes expired shares, sessions, one-time codes and share
codes, login attempts older than a day, and registration counters from earlier
days. Deleting an account removes its items, sessions and login attempts at
once. A share is deleted when its last view is spent, when it is revoked, or by
the cron after it expires. D1's 30-day point-in-time history still holds
deleted rows until it rolls over.

## Organizations (D1)

| Table         | Columns                                                                   | Reveals                                       |
| ------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| `orgs`        | `id`, `name`, `plan`, `created_by`, `created_at`                          | The organization's name, in clear             |
| `org_members` | `org_id`, `account_id`, `role`, `joined_at`                               | Who belongs where, with which role            |
| `org_invites` | `id`, `org_id`, `email`, `role`, `invited_by`, `created_at`, `expires_at` | Invited addresses until they accept or expire |

## Organization store: one Durable Object per organization

`org:<orgId>` (class `OrgStore`) holds:

| Table          | Content                                                                                                                                                                | Reveals                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `members`      | Copy of the members and roles, checked on every call                                                                                                                   | Same as `org_members`                                                                          |
| `teams`        | `id`, `name`, `key_generation`, `rekey_needed`, `created_at`                                                                                                           | Team names, in clear                                                                           |
| `team_members` | Team, account, the team key wrapped for that account's public key, who added them                                                                                      | Who is in which team; not the key                                                              |
| `projects`     | `id`, `team_id`, `sealed` (name, environments and project key, under the team key), `created_by`, `created_at`                                                         | Which team owns how many projects; not their names                                             |
| `secrets`      | `id`, `project_id`, `environment_id`, `sealed` (name, value, note, under the project key), `updated_by`, `updated_at`                                                  | How many secrets each environment has and who changed them when; not names or values           |
| `links`        | `id`, `team_id`, `project_id`, `environment_id`, `repository`, `branch`, `github_environment`, `public_key`, `wrapped_key`, `created_by`, `created_at`, `last_used_at` | Which repositories read which environment, under what rule, and when                           |
| `team_items`   | `id`, `team_id`, `sealed` (the whole item, under the team key), `updated_by`, `updated_at`                                                                             | How many items each team vault holds and who changed them when; not titles, sites or passwords |
| `audit`        | `seq`, `at`, `actor`, `action`, `target`, `ip`, `hash`                                                                                                                 | Who did what, when and from where; never secret values or project and secret names             |

Each audit row's `hash` is SHA-256 over the previous row's hash and the event,
so deleting or editing a row breaks every hash after it.
