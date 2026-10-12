# Limits

Every quota, rate limit, size cap and timer, with the place it is defined. The
code is authoritative; this page is the index to it.

## Rate limits

Enforced per Cloudflare location with the Workers rate limiting binding, so they
are approximate by design. Exceeding one returns `429` with
`server.rate_limited`.

| Limit                 | Value       | Key       | Applies to                                                                                                                       | Defined in      |
| --------------------- | ----------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Anonymous requests    | 30 / minute | Client IP | `register`, `verify-email`, `prelogin`, `login`, `GET /api/shares/:id`, `POST /api/shares/:id/code`, `POST /api/shares/:id/open` | `wrangler.toml` |
| Registration requests | 10 / minute | Client IP | `register`, `verify-email`                                                                                                       | `wrangler.toml` |
| Account writes        | 60 / minute | Account   | `PUT` and `DELETE /api/items/:id`, `POST /api/items/batch`, `POST /api/shares`, `DELETE /api/shares/:id`                         | `wrangler.toml` |

## Abuse limits

Exact, stored in D1.

| Limit                        | Value                      | Result when exceeded                                          | Defined in                   |
| ---------------------------- | -------------------------- | ------------------------------------------------------------- | ---------------------------- |
| Accounts per network per day | 5 (open registration only) | `429 auth.registration_limit`                                 | `src/worker/routes/auth.ts`  |
| Failed logins per email      | 10 within 15 minutes       | Locked for 15 minutes: `429 auth.rate_limited` with `seconds` | `src/worker/routes/auth.ts`  |
| Live items per account       | 5,000                      | `403 items.quota_exceeded`                                    | `src/worker/routes/items.ts` |
| Sessions per account         | 20                         | Oldest session is revoked                                     | `src/worker/session.ts`      |

## Sizes and ranges

| Value                           | Limit                           | Defined in                    |
| ------------------------------- | ------------------------------- | ----------------------------- |
| Item ciphertext                 | 64 KiB decoded                  | `src/worker/routes/items.ts`  |
| Items per import batch          | 100                             | `src/worker/routes/items.ts`  |
| Share ciphertext                | 16 KiB decoded                  | `src/worker/routes/shares.ts` |
| AES-GCM nonce                   | 12 bytes                        | `src/core/crypto.ts`          |
| KDF iterations accepted         | 100,000 – 5,000,000             | `src/worker/routes/auth.ts`   |
| KDF iterations for new accounts | 600,000                         | `src/core/crypto.ts`          |
| Share lifetime (API)            | 60 seconds – 30 days            | `src/worker/routes/shares.ts` |
| Share lifetime (extension)      | 1 hour, **1 day**, 7 or 30 days | `extension/popup/popup.html`  |
| Share views (API)               | 1 – 100, or `null` for no limit | `src/worker/routes/shares.ts` |
| Share views (extension)         | **Once**, or until it expires   | `extension/popup/popup.html`  |
| Share recipients                | 10 email addresses              | `src/worker/share-access.ts`  |
| Share status lookups            | 50 per request                  | `src/worker/routes/shares.ts` |
| Generated password length       | 8 – 64 characters (default 20)  | `extension/popup/popup.html`  |
| Generated passphrase            | 4 – 12 words (default 8)        | `extension/popup/popup.html`  |
| Generated PIN                   | 4 – 12 digits (default 6)       | `extension/popup/popup.html`  |

Bold marks the extension's default.

## Lifetimes and timers

| Timer                              | Value                            | Defined in                                                        |
| ---------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| Session                            | 30 days                          | `src/worker/session.ts`                                           |
| Sign-up verification code          | 6 digits, 15 minutes, 5 attempts | `src/worker/email-verification.ts`, `src/worker/one-time-code.ts` |
| Share access code                  | 6 digits, 10 minutes, 5 attempts | `src/worker/share-access.ts`, `src/worker/one-time-code.ts`       |
| Code resend cooldown               | 60 seconds                       | `src/worker/one-time-code.ts`                                     |
| Expired-row purge                  | Hourly, at minute 17             | `wrangler.toml`                                                   |
| Auto-lock                          | 15 minutes (1 – 120)             | `extension/lib/storage.ts`                                        |
| Clipboard clear after copy         | 30 seconds                       | `extension/lib/clipboard.ts`                                      |
| Clock drift warning                | More than 10 seconds             | `extension/popup/popup.ts`                                        |
| Unfinished sign-up remembered      | 15 minutes                       | `extension/lib/storage.ts`                                        |
| Submitted login offered for saving | 5 minutes                        | `extension/lib/autofill-service.ts`                               |

## Cloudflare free tier

A personal deployment fits well inside the Workers Free plan: 100,000 requests
a day, and 5 GB of D1 storage. Check
[Cloudflare's pricing](https://developers.cloudflare.com/workers/platform/pricing/)
for current numbers; they change independently of this project.
