# Configuration

Everything that configures a deployment, where it is set, and who reads it.

## Worker variables

Plain-text values in the generated Wrangler config, set through deploy options.

| Variable             | Values                         | Set by                                                                    | Effect                                                                                                                                                            |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REGISTRATION_MODE`  | `token` (default), `open`      | `--open-registration`, `--token-registration`                             | `token`: `/api/auth/register` needs the `X-Registration-Token` header. `open`: it does not.                                                                       |
| `EMAIL_FROM`         | An address, or unset           | `--email-from`                                                            | When set and a mail provider is available, sign-up needs an emailed code and restricted share links become available.                                             |
| `TURNSTILE_SITE_KEY` | A Turnstile site key, or unset | `--turnstile-site-key`, or `turnstileSiteKey` in `deploy/production.json` | With `TURNSTILE_SECRET`, sign-up, its email code, account recovery and share-code requests need a Turnstile token in `X-Turnstile-Token`. Either unset: no check. |

## Worker secrets

Encrypted by Cloudflare and never shown again once set. `npm run deploy`
generates the first three; the fourth comes from you.

| Secret               | Required                                  | Generated            | Purpose                                                                                                                                                                   |
| -------------------- | ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REGISTRATION_TOKEN` | Always                                    | Yes, 24 random bytes | Gate on account creation in `token` mode. Without it, anyone who finds the URL can create an account and use the Worker to store their own data.                          |
| `EMAIL_PROBE_SECRET` | Always                                    | Yes, 32 random bytes | Key for decoy KDF salts, recipient and code hashes, the per-network registration counter.                                                                                 |
| `AT_REST_SECRET`     | Always                                    | Yes, 32 random bytes | Root of the server-side layer over auth hashes and wrapped vault keys. **Back it up; never rotate.**                                                                      |
| `RESEND_API_KEY`     | With `--email-from` and provider `resend` | No                   | Sends email through Resend. `deploy` stops until it is set.                                                                                                               |
| `TURNSTILE_SECRET`   | With `--turnstile-site-key`               | No                   | Verifies Turnstile tokens with Cloudflare siteverify. `deploy` stops until it is set. Local dev: pass it with `--var`, since `.dev.vars` only loads the required secrets. |

Set or replace one with:

```bash
npx wrangler secret put <NAME> -c .wrangler.local.toml
```

What changing each one breaks: [Rotate secrets](../how-to/rotate-secrets.md).

## Bindings

Declared in [`wrangler.toml`](../../wrangler.toml).

| Binding                     | Type                             | Purpose                                                                                                                                                                                                  |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB`                        | D1 database `vault`              | All server state; see [Data model](data-model.md).                                                                                                                                                       |
| `ASSETS`                    | Static assets from `dist/public` | Share page, privacy page, favicon.                                                                                                                                                                       |
| `ANONYMOUS_RATE_LIMITER`    | Rate limit                       | Per-IP limit on endpoints reachable without a session (sign-up, prelogin, login, reading a share). Per-address backoff stops password guessing; this stops one client from using up the free-tier quota. |
| `REGISTRATION_RATE_LIMITER` | Rate limit                       | Per-IP limit on registration and verification requests.                                                                                                                                                  |
| `ACCOUNT_RATE_LIMITER`      | Rate limit                       | Per-account limit on writes (items, shares), so one account cannot flood the database.                                                                                                                   |
| `EMAIL`                     | Send email                       | Only with `--email-provider cloudflare`.                                                                                                                                                                 |

Values of the rate limits: [Limits](limits.md).

Other settings in `wrangler.toml`:

| Setting                   | Value                               | Why                                                                                                                                                     |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `triggers.crons`          | `17 * * * *`                        | Hourly purge of expired shares, sessions, codes and counters. Expired ciphertext is unreadable, but keeping data longer than needed is a needless risk. |
| `preview_urls`            | `false`                             | Old versions do not stay reachable at their own URLs after a fix ships.                                                                                 |
| `workers_dev`             | `true` when a custom domain is set  | The `workers.dev` address keeps serving existing installs.                                                                                              |
| `observability.enabled`   | `true`                              | Logs for `npm run logs` and the dashboard.                                                                                                              |
| `assets.run_worker_first` | `/`, `/vi`, `/privacy`, `/security` | The Worker answers these so it can serve Markdown on `Accept: text/markdown` and set the page CSP; every other static file is served directly.          |
| `database_id`             | `SET_BY_DEPLOY`                     | A placeholder. `deploy` writes the real id into `.wrangler.local.toml`, so the public repository carries nobody's identifiers.                          |

## Client configuration

The extension reads one value from the build: the default server URL, taken
from `workerUrl` in `.cf-state.json` when `npm run build` runs. A build from a
checkout that never deployed has no default and asks for a server.

Per-device settings live in `chrome.storage.local` and survive sign-out:

| Setting               | Default                                               | Where to change it                 |
| --------------------- | ----------------------------------------------------- | ---------------------------------- |
| Language              | Match the browser                                     | Settings → Preferences → Language  |
| Auto-lock             | 15 minutes (5 min to 4 h, or when the browser closes) | Settings → Preferences → Auto-lock |
| Autofill and passkeys | Off                                                   | Settings → Preferences → Autofill  |

## Local files

All gitignored. None should be committed or shared.

| File                   | Written by     | Contents                                                                                                           |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `.wrangler.local.toml` | `deploy`       | `wrangler.toml` plus your account id, database id and options. Regenerated on every deploy; do not edit.           |
| `.cf-state.json`       | `deploy`       | Account, database id, Worker URL, saved deploy options.                                                            |
| `.secrets.local.txt`   | `deploy`, once | The generated `REGISTRATION_TOKEN` and `AT_REST_SECRET`. Move them offline and delete the file.                    |
| `.dev.vars`            | `dev`          | Secrets for the local Worker, independent of production. Template: [`.dev.vars.example`](../../.dev.vars.example). |
| `backups/*.sql`        | `backup`       | Database exports, mode 600.                                                                                        |
