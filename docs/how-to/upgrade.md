# Upgrade a deployment

Move a running deployment to a newer release. Read the release's entry in
[`CHANGELOG.md`](../../CHANGELOG.md) first; anything that needs more than the
routine below is listed there.

## Routine upgrade

```bash
npm run upgrade
```

It stops if tracked files have local changes, then backs up the database,
pulls the latest release (`git pull --ff-only`), reinstalls dependencies and
runs `npm run deploy`, which applies new migrations and reuses your saved
options (registration mode, domain, email sender). The same steps by hand:

```bash
npm run backup
git pull
npm ci
npm run deploy
```

Then update the extension everywhere it runs:

- **Loaded unpacked:** `dist/extension` was rebuilt by the deploy. Copy it to
  each machine that uses its own copy, then press the reload icon on 7key in
  `chrome://extensions`.
- **Published:** run `npm run package` and upload the zip; see
  [Publish to the Chrome Web Store](publish-to-chrome-web-store.md).

## Order matters

Deploy the server before updating extensions. The server accepts requests from
the previous extension release unless the changelog says otherwise; the
reverse is not promised, so a new extension against an old server can fail on
endpoints that do not exist yet.

Migrations only add tables and columns, so the previous Worker version keeps
working against the migrated database while the new one rolls out.

## If something goes wrong

- **Worker misbehaves:** `npx wrangler rollback -c .wrangler.local.toml`
  returns to the previous Worker version. The database keeps its new columns,
  which the old code ignores.
- **Data went wrong:** restore the database to a time before the deploy; see
  [Back up and restore](back-up-and-restore.md#restore-to-a-point-in-time).

## From 0.2.x to 0.3.0

1. `npm run deploy`. Migrations `0009_orgs.sql` and `0010_org_domains.sql`
   add the organization tables and a column; nothing is rewritten.
2. Reload the extension. Its ID changes once, because the manifest now carries
   a fixed key: sign in again on each machine and turn PIN or device unlock
   back on. After this, the ID stays the same.
3. Remove the old copy of the extension from `chrome://extensions` once the new
   one has synced.

## From 0.1.x to 0.2.0

0.2.0 changes the API and the at-rest format. Do these in order:

1. `npm run deploy`. It adds `AT_REST_SECRET` and writes it to
   `.secrets.local.txt`. Back it up offline, then delete it from that file.
2. Reload the extension on **every** machine. A 0.1 extension cannot change
   the master password against a 0.2 server, and items it creates are rejected
   by 0.2 extensions, which only accept items bound to their id.
3. Unlock once on each machine while online. The server re-seals the stored
   hash and wrapped key on that login, and the extension re-encrypts older items
   after its first sync.
