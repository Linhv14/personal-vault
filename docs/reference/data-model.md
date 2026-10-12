# Data model

The D1 database `vault`, built by the files in [`migrations/`](../../migrations).
The last column of each table says what someone holding a copy of the database
learns from it.

"Keyed hash" means HMAC-SHA256 under `EMAIL_PROBE_SECRET`, base64 encoded:
without the secret, the original value cannot be confirmed by guessing.

## `accounts`

| Column              | Content                                                                                                             | Reveals                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `id`                | Random UUID                                                                                                         | Nothing                    |
| `email`             | Normalized address, unique                                                                                          | **The address, in clear**  |
| `kdf_type`          | `pbkdf2-sha256`                                                                                                     | Nothing                    |
| `kdf_iterations`    | Iteration count                                                                                                     | Nothing                    |
| `kdf_salt`          | Random salt, base64                                                                                                 | Nothing                    |
| `auth_key_hash`     | `v2:` + HMAC of the auth key under a key derived from `AT_REST_SECRET`                                              | Nothing without the secret |
| `wrapped_vault_key` | `v2:` + vault key wrapped by the client, sealed again under `AT_REST_SECRET` with the account id as associated data | Nothing without the secret |
| `wrap_nonce`        | Nonce of the client-side wrap                                                                                       | Nothing                    |
| `created_at`        | Unix seconds                                                                                                        | Sign-up time               |

Values without the `v2:` prefix come from before 0.2.0 and are rewritten on
the account's next login.

## `items`

| Column       | Content                                                  | Reveals                     |
| ------------ | -------------------------------------------------------- | --------------------------- |
| `id`         | UUID chosen by the client                                | Nothing                     |
| `account_id` | Owner                                                    | Which account owns the item |
| `ciphertext` | Whole item sealed under the vault key, `''` once deleted | Approximate size            |
| `nonce`      | AES-GCM nonce, `''` once deleted                         | Nothing                     |
| `updated_at` | Unix seconds                                             | When it last changed        |
| `deleted_at` | Unix seconds, or null                                    | When it was deleted         |

Index `(account_id, updated_at)` serves delta sync. Deleted rows stay as
tombstones so offline devices learn about the deletion; they are removed only
with the account.

## `sessions`

| Column       | Content                     | Reveals                     |
| ------------ | --------------------------- | --------------------------- |
| `token_hash` | SHA-256 of the bearer token | Nothing usable              |
| `account_id` | Owner                       | Number of signed-in devices |
| `created_at` | Unix seconds                | Sign-in times               |
| `expires_at` | Unix seconds                | Nothing                     |

## `shares`

| Column        | Content                                 | Reveals                     |
| ------------- | --------------------------------------- | --------------------------- |
| `id`          | 16 random bytes, base64url              | Nothing                     |
| `ciphertext`  | Share payload sealed under the link key | Approximate size            |
| `nonce`       | AES-GCM nonce                           | Nothing                     |
| `expires_at`  | Unix seconds                            | Lifetime                    |
| `max_views`   | 1 – 100                                 | View limit                  |
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
