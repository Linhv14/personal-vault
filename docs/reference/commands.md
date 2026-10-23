# Commands

All commands run from the repository root with Node 22 or newer.

## Operating a deployment

| Command           | What it does                                                                                                                                  | Touches                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `npm run deploy`  | Creates the D1 database and secrets if absent, applies migrations, builds, deploys, rebuilds the extension. Idempotent.                       | Cloudflare account, `dist/`, local state files         |
| `npm run upgrade` | Refuses when tracked files have local changes. Otherwise runs `backup`, `git pull --ff-only`, `npm ci`, then `deploy` with the saved options. | Cloudflare account, the git clone, `backups/`, `dist/` |
| `npm run status`  | Prints the account, database id, Worker URL and recent deployments.                                                                           | Read-only                                              |
| `npm run logs`    | Streams the Worker's live logs (`wrangler tail`).                                                                                             | Read-only                                              |
| `npm run backup`  | Exports the remote database to `backups/vault-<timestamp>.sql`, mode 600.                                                                     | `backups/`                                             |

`deploy` accepts options, remembered in `.cf-state.json` for later runs:

| Option                        | Effect                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `--open-registration`         | Anyone can create an account.                                                                             |
| `--token-registration`        | Creating an account needs `REGISTRATION_TOKEN` (default).                                                 |
| `--domain <host>`             | Serve on a custom domain in the same account. `none` removes it.                                          |
| `--email-from <address>`      | Send verification and share codes from this address; requires verification at sign-up. `none` removes it. |
| `--email-provider <provider>` | `resend` (default, needs the `RESEND_API_KEY` secret) or `cloudflare` (Workers Paid).                     |

Pass options after `--`: `npm run deploy -- --open-registration`.

With credentials that reach more than one account, `deploy` asks which one to
use. Set `CLOUDFLARE_ACCOUNT_ID` to skip the question, for example in a
non-interactive shell.

## Development

| Command             | What it does                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Worker and local D1 at `http://127.0.0.1:8787`. Creates `.dev.vars` if missing.                                                               |
| `npm run build`     | Builds the Worker assets and the extension into `dist/`, with the last deployed Worker URL (from `.cf-state.json`) as the extension's server. |
| `npm run build:dev` | Same, unminified and with inline source maps.                                                                                                 |
| `npm run package`   | Builds and zips the extension to `dist/7key-extension-<version>.zip`.                                                                         |

## Quality checks

| Command                | What it does                                               |
| ---------------------- | ---------------------------------------------------------- |
| `npm test`             | Unit tests (Vitest).                                       |
| `npm run test:watch`   | Unit tests in watch mode.                                  |
| `npm run typecheck`    | TypeScript for the browser project and the Worker project. |
| `npm run format`       | Formats with Prettier.                                     |
| `npm run format:check` | Fails if anything is not formatted.                        |

End-to-end tests run against a live local Worker and are skipped otherwise:

```bash
npm run dev
VAULT_E2E=1 npx vitest run test/e2e.test.ts
```

To check the `/s/:id` page in a real browser, `scripts/make-share-link.ts`
creates a share against the local Worker and prints its link:

```bash
npx esbuild scripts/make-share-link.ts --bundle --platform=node --format=esm --outfile=dist/mk.mjs
node dist/mk.mjs
```

## Calling Wrangler directly

`wrangler.toml` is a template with no account or database id. Wrangler commands
against your deployment need the generated file:

```bash
npx wrangler <command> -c .wrangler.local.toml
```
