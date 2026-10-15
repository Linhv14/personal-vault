# HTTP API

The Worker's API, as used by the extension and the share page. It is not a
public, versioned API: it changes with the extension, and only the extension
from the same release is guaranteed to work with it.

## Conventions

- **Base URL:** `https://<worker>/api`.
- **Bodies:** JSON in, JSON out. Timestamps are Unix seconds. Binary values
  (ciphertext, nonces, keys, salts) are standard base64 with padding, except
  where noted as base64url.
- **Authentication:** `Authorization: Bearer <token>`, where the token comes
  from `register` or `login`. There are no cookies, so there is no CSRF
  surface.
- **CORS:** only `chrome-extension://` and `moz-extension://` origins are
  allowed. The share page calls the API from the same origin and needs no CORS.
- **Sealed value:** an object `{ "ciphertext": string, "nonce": string }`
  produced by AES-256-GCM with a 12-byte nonce.
- **Errors:** every failure has the shape below. `code` is stable and meant for
  programs; `error` is an English sentence for humans; `params` holds values for
  the localized message.

  ```json
  {
    "code": "auth.rate_limited",
    "error": "Too many attempts, try again later",
    "params": { "seconds": 840 }
  }
  ```

Rate limits per endpoint are listed in [Limits](limits.md). Any endpoint can
also return `429 server.rate_limited` and `500 server.error`.

## Server

### `GET /api/config`

What the server requires at sign-up. No authentication.

```json
{ "registration": "token", "emailVerification": false }
```

`registration` is `token` or `open`. `emailVerification` is `true` when a
sender and a mail provider are configured.

### `GET /api/time`

The server clock, used by the extension to correct 2FA codes on a machine whose
clock is off.

```json
{ "serverTime": 1791820800 }
```

### `GET /api/logo?domain=<hostname>`

Session required. Returns the website icon for a hostname as an image, fetched
from DuckDuckGo or, failing that, Google, and cached at the edge for 7 days.
The hostname must be a plain domain name; anything else, or a site without an
icon, answers `404 server.not_found`. Images over 64 KiB are refused. The
response is `Cache-Control: private, no-store`, so browsers keep no copy.

## Accounts

### `POST /api/auth/verify-email`

Send a 6-digit sign-up code to an address. Only meaningful when
`emailVerification` is on.

| Field    | Type   | Notes                  |
| -------- | ------ | ---------------------- |
| `email`  | string | Required               |
| `locale` | string | `en` (default) or `vi` |

| Status | Body / code                                                                               |
| ------ | ----------------------------------------------------------------------------------------- |
| 200    | `{ "ok": true, "required": true }`; or `"required": false` when the server sends no email |
| 400    | `auth.invalid_email`                                                                      |
| 429    | `auth.code_cooldown` with `params.seconds`                                                |
| 502    | `auth.email_failed`                                                                       |

An address that already has an account receives a "you already have an
account" email instead of a code, and the response is the same, so the endpoint
does not reveal which addresses are registered.

### `POST /api/auth/register`

Create an account. The client derives every key; the server receives only the
auth key and the wrapped vault key.

Header `X-Registration-Token` is required when `registration` is `token`.

| Field              | Type   | Notes                                                                                  |
| ------------------ | ------ | -------------------------------------------------------------------------------------- |
| `email`            | string | Normalized to lower case                                                               |
| `kdf`              | object | `{ "type": "pbkdf2-sha256", "iterations": 100000–5000000, "salt": base64 ≤ 64 bytes }` |
| `authKey`          | string | base64, 32 bytes                                                                       |
| `wrappedVaultKey`  | sealed | The vault key sealed under the wrapping key                                            |
| `verificationCode` | string | 6 digits; required when `emailVerification` is on                                      |

| Status | Body / code                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 201    | `{ "accountId": string, "token": string, "expiresAt": number }`                                                                                              |
| 400    | `auth.invalid_body`, `auth.invalid_email`, `auth.invalid_kdf`, `auth.invalid_auth_key`, `auth.invalid_wrapped_key`, `auth.invalid_code`, `auth.code_expired` |
| 403    | `auth.bad_registration_token`                                                                                                                                |
| 409    | `auth.email_taken`                                                                                                                                           |
| 429    | `auth.registration_limit`                                                                                                                                    |

### `POST /api/auth/prelogin`

The KDF parameters to derive the auth key with, before signing in.

Request `{ "email": string }`. Response:

```json
{ "kdf": { "type": "pbkdf2-sha256", "iterations": 600000, "salt": "…" } }
```

An unknown address gets plausible parameters derived from a server secret, the
same on every call, so the response does not reveal whether an account exists.

### `POST /api/auth/login`

| Field     | Type   | Notes            |
| --------- | ------ | ---------------- |
| `email`   | string |                  |
| `authKey` | string | base64, 32 bytes |

| Status | Body / code                                                                    |
| ------ | ------------------------------------------------------------------------------ |
| 200    | `{ "token": string, "expiresAt": number, "wrappedVaultKey": sealed }`          |
| 400    | `auth.invalid_credentials` (malformed body)                                    |
| 401    | `auth.invalid_credentials` (wrong email or key; the two are not distinguished) |
| 429    | `auth.rate_limited` with `params.seconds` until the lock ends                  |

### `GET /api/auth/resume-key`

Authenticated. Returns `{ "resumeKey": "<base64>" }`, a random 32-byte key that
belongs to this session and is created on first request. The extension seals
the vault key under it so the vault reopens after a browser restart; deleting
the session deletes the key.

### `PUT /api/auth/pin`

Authenticated. Body `{ "verifier": "<base64, 32 bytes>" }`. Turns on PIN unlock
for this session: stores a keyed hash of the verifier, creates a random
32-byte `pinKey`, resets the attempt count and returns `{ "pinKey": string }`.
The extension derives the verifier and a second, local half from the PIN with
PBKDF2; the server never sees the PIN or the local half.

### `POST /api/auth/pin/unlock`

Authenticated with the session the PIN belongs to. Body `{ "verifier": ... }`.

| Status | Body / code                                                        |
| ------ | ------------------------------------------------------------------ |
| 200    | `{ "pinKey": string }`; the attempt count resets                   |
| 403    | `auth.pin_wrong` with `params.count`, the tries left               |
| 410    | `auth.pin_off`: no PIN, or the fifth wrong try just wiped it       |
| 401    | `auth.unauthorized`: the session ended, so the PIN is gone with it |

Each call spends a try before comparing, in one statement, so parallel guesses
cannot exceed five.

### `DELETE /api/auth/pin`

Authenticated. Turns PIN unlock off for this session. Returns `{ "ok": true }`.

### `PUT /api/auth/biometric`

Authenticated. Body `{ credentialId, publicKey, algorithm, rpId, origin }`: the
credential a platform authenticator (Touch ID, Windows Hello) just created on
an extension page, its public key as base64url SPKI, `-7` (ES256) or `-257`
(RS256), and the extension's origin `chrome-extension://<id>` with that id as
RP ID. Anything else is `400 auth.invalid_body`. Returns `{ "bioKey": string }`,
a random 32-byte key for this session.

### `POST /api/auth/biometric/challenge`

Authenticated. Returns `{ challenge, credentialId }`: a one-time base64url
challenge that expires in two minutes, or `410 auth.biometric_off`. The session
keeps its five most recent open challenges, so a second request does not void
a prompt that is still on screen.

### `POST /api/auth/biometric/unlock`

Authenticated. Body `{ clientDataJSON, authenticatorData, signature }` from
`navigator.credentials.get`. The challenge named in `clientDataJSON` must be one
of the session's open challenges, and it is spent before anything else is checked,
then the server verifies the type, challenge, origin, RP ID hash, the user
present and user verified flags, and the signature against the registered key.
Returns `{ "bioKey": string }`, or `403 auth.biometric_failed`.

### `DELETE /api/auth/biometric`

Authenticated. Turns biometric unlock off for this session.

### `POST /api/auth/logout`

Authenticated. Revokes the current session. Returns `{ "ok": true }`.

### `POST /api/auth/change-password`

Authenticated. Replaces the KDF parameters, auth key and wrapped vault key in
one step, then revokes every session of the account.

| Field             | Type   | Notes                                              |
| ----------------- | ------ | -------------------------------------------------- |
| `currentAuthKey`  | string | Proves knowledge of the current password           |
| `kdf`             | object | As in `register`                                   |
| `authKey`         | string | The new auth key                                   |
| `wrappedVaultKey` | sealed | The same vault key, wrapped under the new password |

Returns `{ "ok": true }`, or `400` for a malformed field and
`403 auth.invalid_credentials` when `currentAuthKey` is wrong.

### `POST /api/auth/delete-account`

Authenticated. Request `{ "currentAuthKey": string }`. Deletes the account, its
items and its sessions. Returns `{ "ok": true }`, or
`403 auth.invalid_credentials`.

Shares are not linked to accounts, so links already sent keep working until
they expire or run out of views.

## Account key pair

Every account has an ECDH P-256 key pair so that team keys can be wrapped for it
(see [Teams and CI secrets](../explanation/teams.md)). The extension creates it
the first time the vault opens.

### `GET /api/account/identity`

Authenticated. Returns `{ "identity": { publicKey, wrappedPrivateKey } }`, or
`{ "identity": null }` before one exists. `wrappedPrivateKey` is sealed under the
vault key; the server cannot open it.

### `PUT /api/account/identity`

Authenticated. Body `{ publicKey, wrappedPrivateKey }`. Stores the pair once;
`409 account.identity_exists` afterwards, so a stolen session cannot swap in a
key its holder controls.

## Organizations

All authenticated. Membership and roles live in D1; teams, wrapped team keys
and the audit log live in the organization's Durable Object (`org:<id>`), which
checks the caller's role again against its own copy. An organization the caller
is not in answers `404 orgs.not_found`, never `403`, so its existence does not
leak.

| Method and path                                                                   | Who                                              | Does                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/orgs`                                                                   | anyone                                           | Organizations the caller belongs to, with their role                                                                                                                                                                                                                       |
| `POST /api/orgs` `{ name }`                                                       | anyone, up to 10 owned                           | Creates one; the caller is its owner                                                                                                                                                                                                                                       |
| `GET /api/orgs/:id`                                                               | members                                          | The organization, its members (email, role, public key), pending invitations (admins only) and teams. Members see their own teams; admins see all team names but get a wrapped key only for teams they are in                                                              |
| `POST /api/orgs/:id/invites` `{ email, role, locale? }`                           | admins (owners for `admin`)                      | Invites an address for 14 days and emails it. `409 orgs.seat_limit` with `params.limit` when members plus pending invitations fill the plan's seats                                                                                                                        |
| `DELETE /api/orgs/:id/invites/:inviteId`                                          | admins                                           | Withdraws an invitation                                                                                                                                                                                                                                                    |
| `PATCH /api/orgs/:id/members/:accountId` `{ role }`                               | owner                                            | Makes someone admin or member                                                                                                                                                                                                                                              |
| `POST /api/orgs/:id/owner` `{ accountId }`                                        | owner                                            | Makes another member the owner; the caller becomes an admin                                                                                                                                                                                                                |
| `DELETE /api/orgs/:id/members/:accountId`                                         | owner, admins for members, anyone for themselves | Removes them from the organization and its teams; affected teams are flagged for re-keying                                                                                                                                                                                 |
| `POST /api/orgs/:id/teams` `{ id, name, wrappedKey }`                             | admins                                           | Creates a team at key generation 0; `wrappedKey` is the new team key wrapped for the caller. `409 orgs.team_limit` with `params.limit` past the plan's teams                                                                                                               |
| `PUT /api/orgs/:id/teams/:teamId/members/:accountId` `{ wrappedKey, generation }` | admins who are in the team                       | Adds someone with the team key wrapped for their public key. `generation` must be the team's current one, else `409 orgs.stale_team_key`                                                                                                                                   |
| `PUT /api/orgs/:id/teams/:teamId/key` `{ generation, wrappedKeys }`               | admins who are in the team                       | Replaces the team key: `generation` is the current one plus 1 and `wrappedKeys` maps every current team member, no more and no fewer, to the new key wrapped for them. Clears the re-key flag. `409 orgs.stale_team_key` or `409 orgs.team_changed` when the team moved on |
| `DELETE /api/orgs/:id/teams/:teamId/members/:accountId`                           | admins                                           | Removes them and flags the team for re-keying                                                                                                                                                                                                                              |
| `DELETE /api/orgs/:id/teams/:teamId`                                              | admins                                           | Deletes the team                                                                                                                                                                                                                                                           |
| `GET /api/orgs/:id/audit?before=<seq>`                                            | admins                                           | 100 most recent events before `seq`, and whether the hash chain verifies                                                                                                                                                                                                   |
| `GET /api/invites`                                                                | anyone                                           | Invitations for the caller's email                                                                                                                                                                                                                                         |
| `POST /api/invites/:id/accept`                                                    | the invited address                              | Joins the organization with the invited role                                                                                                                                                                                                                               |
| `DELETE /api/invites/:id`                                                         | the invited address                              | Declines                                                                                                                                                                                                                                                                   |

## Items

All item endpoints require authentication. An item is a single sealed blob; the
server never sees its fields.

### `GET /api/items?since=<timestamp>`

Changes since a cursor, oldest first. Omit `since` (or send `0`) for everything.

```json
{
  "serverTime": 1791820799,
  "items": [
    { "id": "…", "ciphertext": "…", "nonce": "…", "updatedAt": 1791820700, "deletedAt": null },
    {
      "id": "…",
      "ciphertext": null,
      "nonce": null,
      "updatedAt": 1791820750,
      "deletedAt": 1791820750
    }
  ]
}
```

Use `serverTime` as the next `since`. A deleted item comes back as a tombstone
with `deletedAt` set and no ciphertext.

### `PUT /api/items/:id`

Create or replace an item. `:id` is a UUID chosen by the client. Body: a sealed
value, ciphertext at most 64 KiB.

| Status | Body / code                                                                   |
| ------ | ----------------------------------------------------------------------------- |
| 200    | `{ "id": string, "updatedAt": number }`                                       |
| 400    | `items.invalid_id`, `items.invalid_payload`                                   |
| 403    | `items.forbidden` (the id belongs to another account), `items.quota_exceeded` |

Writing to a deleted item's id restores it.

With `?ifUpdatedAt=<number>` the write is conditional: it replaces the item only
if it still exists and its `updatedAt` equals that number, and never creates or
restores one. Otherwise it returns `409 items.conflict`. The extension uses it
for background writes such as recording when a login was last used, so they
cannot overwrite an edit or undo a deletion made on another device.

### `POST /api/items/batch`

Create up to 100 new items in one request, for imports. Body:
`{ "items": [{ "id": uuid, "ciphertext": string, "nonce": string }] }`.

Returns `{ "updatedAt": number, "created": string[] }`. An id that already
exists, in this account or another, is left untouched and is missing from
`created`. Errors: `400 items.invalid_id`, `400 items.invalid_payload` (empty,
more than 100, or a malformed item), `403 items.quota_exceeded` when the batch
would take the account past its item limit. The whole batch counts as one
write for rate limiting.

### `DELETE /api/items/:id`

Replaces the item with a tombstone. Returns `{ "id": string, "deletedAt": number }`,
or `404 items.not_found`.

## Shares

### `POST /api/shares`

Authenticated. Store an encrypted share. The key stays in the link fragment
and never reaches the server.

| Field        | Type              | Notes                                                                  |
| ------------ | ----------------- | ---------------------------------------------------------------------- |
| `ciphertext` | string            | ≤ 16 KiB decoded                                                       |
| `nonce`      | string            | 12 bytes                                                               |
| `ttlSeconds` | number            | 60 – 2,592,000                                                         |
| `maxViews`   | integer or `null` | 1 – 100, or `null` for no view limit (the link works until it expires) |
| `recipients` | string[]          | Optional, up to 10 addresses; needs email on the server                |

| Status | Body / code                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ "id": string, "expiresAt": number, "maxViews": number \| null, "revokeToken": string }`                                          |
| 400    | `shares.invalid_payload`, `shares.invalid_ttl`, `shares.invalid_max_views`, `shares.invalid_recipients`, `shares.email_unavailable` |

`id` and `revokeToken` are base64url. The server stores only a hash of
`revokeToken`; keep it to revoke or check the share later.

The link is `https://<worker>/s/<id>#<key>`, where `<key>` is the base64url
share key, followed by `.p` when the link also needs a passphrase.

### `POST /api/shares/status`

Authenticated. Look up shares you created. Request:

```json
{ "shares": [{ "id": "…", "revokeToken": "…" }] }
```

Up to 50 entries. Each answer is either
`{ "id", "active": true, "expiresAt", "viewsLeft" }` or `{ "id", "active": false }`.
`viewsLeft` is `null` for a link without a view limit.
A wrong token reads as inactive.

### `DELETE /api/shares/:id`

Authenticated. Header `X-Revoke-Token: <token>`. Deletes the share at once.
Returns `{ "ok": true }`, or `404 shares.gone` for an unknown id or a wrong
token.

### `GET /api/shares/:id`

No authentication. Spends one view and returns the ciphertext:

```json
{ "ciphertext": "…", "nonce": "…", "expiresAt": 1791907200, "viewsLeft": 0 }
```

`viewsLeft` is `null` when the link has no view limit, and `0` when this was
the last view.

| Status | Code                                                                        |
| ------ | --------------------------------------------------------------------------- |
| 403    | `shares.email_required`: restricted share; no view is spent                 |
| 404    | `shares.gone`: unknown, expired, revoked or out of views, indistinguishably |

### `POST /api/shares/:id/code`

No authentication. Request `{ "email": string, "locale"?: "en" | "vi" }`.
Emails a 6-digit code if the address is a recipient of the share.

Always returns `{ "ok": true }`, whether or not the address is allowed, the
share exists, a cooldown applies, or sending failed. Anything else would let
someone test addresses against the recipient list.

### `POST /api/shares/:id/open`

No authentication. Request `{ "email": string, "code": string }`. On success,
spends one view and returns the same body as `GET /api/shares/:id`.

Errors: `400 shares.invalid_code`, `400 shares.code_expired`, `404 shares.gone`.

## Pages

| Path                          | Content                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `/s/:id`                      | The recipient page. Served with `Cache-Control: no-store` and a strict CSP. |
| `/`, `/vi`                    | The landing page, in English and Vietnamese.                                |
| `/download/1pw-extension.zip` | The extension built for this server, for loading unpacked.                  |
| `/privacy`                    | The privacy policy.                                                         |

## Error codes

| Code                          | Status        | Meaning                                                          |
| ----------------------------- | ------------- | ---------------------------------------------------------------- |
| `auth.bad_registration_token` | 403           | Missing or wrong `X-Registration-Token`                          |
| `auth.invalid_body`           | 400           | Body is not a JSON object                                        |
| `auth.invalid_email`          | 400           | Not an email address                                             |
| `auth.invalid_kdf`            | 400           | KDF type, iterations or salt out of bounds                       |
| `auth.invalid_auth_key`       | 400           | Auth key is not 32 bytes of base64                               |
| `auth.invalid_wrapped_key`    | 400           | Wrapped vault key is not a valid sealed value                    |
| `auth.email_taken`            | 409           | An account already uses the address                              |
| `auth.registration_limit`     | 429           | Daily account limit for this network reached                     |
| `auth.invalid_code`           | 400           | Sign-up code is wrong or missing                                 |
| `auth.code_expired`           | 400           | Sign-up code expired or used up its attempts                     |
| `auth.code_cooldown`          | 429           | A code was sent less than a minute ago                           |
| `auth.email_failed`           | 502           | The mail provider rejected the message                           |
| `auth.invalid_credentials`    | 400, 401, 403 | Wrong email or key, or a malformed credential                    |
| `auth.rate_limited`           | 429           | Too many failed logins for this email                            |
| `auth.unauthorized`           | 401           | Missing, unknown or expired session token                        |
| `items.invalid_id`            | 400           | Id is not a UUID                                                 |
| `items.invalid_payload`       | 400           | Ciphertext or nonce malformed or too large                       |
| `items.forbidden`             | 403           | The id belongs to another account                                |
| `items.not_found`             | 404           | No live item with that id                                        |
| `items.quota_exceeded`        | 403           | The account holds the maximum number of items                    |
| `shares.invalid_payload`      | 400           | Ciphertext or nonce malformed or too large, or a bad status list |
| `shares.invalid_ttl`          | 400           | `ttlSeconds` out of range                                        |
| `shares.invalid_max_views`    | 400           | `maxViews` missing, or not `null` or 1 – 100                     |
| `shares.invalid_recipients`   | 400           | More than 10 recipients or an invalid address                    |
| `shares.email_unavailable`    | 400           | Recipients given, but the server cannot send email               |
| `shares.gone`                 | 404           | Share unknown, expired, revoked or out of views                  |
| `shares.email_required`       | 403           | Restricted share; open it with an emailed code                   |
| `shares.invalid_code`         | 400           | Share code wrong or missing                                      |
| `shares.code_expired`         | 400           | Share code expired or used up its attempts                       |
| `server.rate_limited`         | 429           | Rate limit reached                                               |
| `server.not_found`            | 404           | No such endpoint                                                 |
| `server.error`                | 500           | Unexpected failure; details go to the Worker log only            |
