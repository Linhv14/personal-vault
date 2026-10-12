# Back up and restore

A deployment has two things that cannot be regenerated: the D1 database and
`AT_REST_SECRET`. Each is useless without the other. Back them up together and
keep the copies offline.

| Asset                                                        | Lost means                                            | Where it lives                           |
| ------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------- |
| D1 database `vault`                                          | Every vault is gone                                   | Cloudflare                               |
| `AT_REST_SECRET`                                             | Every account is locked out, data intact but unusable | Worker secret; `.secrets.local.txt` once |
| Master password                                              | That one vault is gone; nobody can recover it         | The user's memory                        |
| `REGISTRATION_TOKEN`, `EMAIL_PROBE_SECRET`, `RESEND_API_KEY` | Replaceable, see [Rotate secrets](rotate-secrets.md)  | Worker secrets                           |

## Keep `AT_REST_SECRET` safe

The first `npm run deploy` writes it to `.secrets.local.txt`, once. Copy it to
offline storage (a password manager other than this one, or paper in a safe),
then delete the line from the file. Cloudflare will not show a secret again
after it is set, so this file is the only place you can read it from.

## Take a backup

```bash
npm run backup
```

This exports the production database to `backups/vault-<timestamp>.sql`
(gitignored, file mode 600). The export holds ciphertext, hashes and metadata
such as account emails; treat it as sensitive.

Store each export next to a copy of `AT_REST_SECRET`. Run it on a schedule, and
before every upgrade.

## Restore to a point in time

D1 keeps 30 days of history and can roll the database back to any minute in it.
Use this after a bad migration or a mistaken bulk change.

```bash
npx wrangler d1 time-travel info vault -c .wrangler.local.toml
npx wrangler d1 time-travel restore vault --timestamp=2026-10-12T08:00:00Z -c .wrangler.local.toml
```

Restoring replaces the current database: every account, item and share
written after the timestamp disappears from the server. On a shared server,
tell users before you do it.

## Restore from an export

An export holds the whole schema plus the migration history
(`d1_migrations`), so it must go into an **empty** database. Migrations that
the export does not record are applied afterwards.

When the database is gone, or you are moving to another Cloudflare account:

1. Create an empty database in the target account:

   ```bash
   npx wrangler d1 create vault
   ```

2. Load the export into it:

   ```bash
   npx wrangler d1 execute vault --remote --file backups/vault-<timestamp>.sql
   ```

3. Deploy. `npm run deploy` finds the existing `vault` database, applies only
   the migrations it is missing, and deploys the Worker.
4. Put the backed-up `AT_REST_SECRET` back **before** anyone signs in, since the
   deploy generated a new one for a new Worker:

   ```bash
   npx wrangler secret put AT_REST_SECRET -c .wrangler.local.toml
   ```

5. Sign in from the extension and confirm the items decrypt.

With credentials for more than one account, set `CLOUDFLARE_ACCOUNT_ID` for
steps 1 and 2. If the Worker address changed, rebuild the extension
(`npm run build`) or have users enter the new address under **Use your own
server**.

## Test your backups

A backup you have not restored is a hope. Restore the latest export into a
throwaway local database once in a while:

```bash
npx wrangler d1 execute vault --local --persist-to .wrangler/restore-test --file backups/vault-<timestamp>.sql
npx wrangler d1 migrations apply vault --local --persist-to .wrangler/restore-test
npx wrangler dev --port 8787 --persist-to .wrangler/restore-test
```

For sign-in to work against it, the Worker needs the production
`AT_REST_SECRET` in `.dev.vars`. Put it there only for the drill, and restore
your development value afterwards.
