# Upgrade a deployment

Move a running deployment to a newer release. Read the release's entry in
[`CHANGELOG.md`](../../CHANGELOG.md) first; anything that needs more than the
routine below is listed there.

## Routine upgrade

```bash
npm run backup          # a copy to fall back on
git pull
npm ci
npm run deploy          # applies new migrations, then deploys
```

`npm run deploy` reuses your saved options (registration mode, domain, email
sender), so you do not repeat the flags.

Then update the extension everywhere it runs:

- **Loaded unpacked:** `dist/extension` was rebuilt by the deploy. Copy it to
  each machine that uses its own copy, then press the reload icon on 1PW in
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
