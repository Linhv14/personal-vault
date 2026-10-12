# Run a shared server

Let people other than you create accounts on your Worker: open registration,
email verification, and your own domain.

Running a server for others makes you responsible for their ciphertext and its
availability. You still cannot read their vaults, but you can lose them. Set up
[backups](back-up-and-restore.md) before you invite anyone.

## Open registration

```bash
npm run deploy -- --open-registration
```

Anyone with the extension can now create an account without a registration
token. The setting is saved in `.cf-state.json` and reused by later deploys;
`--token-registration` turns it back off.

Abuse limits that apply from then on are listed in
[Limits](../reference/limits.md): accounts per network per day, items per
account, writes per minute, and sessions per account.

## Require email verification

Without verification an email address is only an account name: anyone can
register an address they do not own. To require a code sent to that address:

1. Choose a sender address on a domain you control, such as
   `no-reply@example.com`.
2. Create a [Resend](https://resend.com) account and add the domain. Add the
   DNS records Resend shows (DKIM, SPF on the return-path subdomain, MX), and
   wait until the domain reads **Verified**.
3. In Resend, turn off open and click tracking for the domain. Verification
   emails should not carry tracking pixels or rewritten links.
4. Create an API key with **Sending access** for that domain only, and store it
   as a Worker secret:

   ```bash
   npx wrangler secret put RESEND_API_KEY -c .wrangler.local.toml
   ```

5. Deploy with the sender address:

   ```bash
   npm run deploy -- --email-from no-reply@example.com
   ```

New sign-ups now take two steps: the email address, then the emailed code
with the master password. The popup remembers the first step for 15 minutes,
so closing it to read the email loses nothing. Restricting a share link to
specific recipients also becomes available.

A `_dmarc` TXT record (start with `v=DMARC1; p=none;`) is not required by Resend
but is expected by Gmail and Yahoo for good delivery.

### Cloudflare Email Sending instead of Resend

On a Workers Paid plan you can send through Cloudflare's own service and skip
the API key:

```bash
npx wrangler email sending enable example.com
npm run deploy -- --email-from no-reply@example.com --email-provider cloudflare
```

If `RESEND_API_KEY` is also set, Resend is used.

### Turning it off

`npm run deploy -- --email-from none` removes the sender. Pending codes stop
being accepted and sign-up returns to one step.

## Serve on your own domain

The domain must be a zone in the same Cloudflare account.

```bash
npm run deploy -- --domain vault.example.com
```

Cloudflare creates the DNS record and certificate. The `workers.dev` address
keeps working, so extensions built before the change are not stranded. Rebuild
the extension afterwards (`npm run build`) so new builds use the new address.

`--domain none` removes the custom domain.

## Before you invite strangers

- Check that `https://<worker>/privacy` describes what you actually run. Edit
  [`share/privacy.html`](../../share/privacy.html), especially the contact
  section.
- Back up the database and `AT_REST_SECRET` together, offline.
- Decide how you will tell users about an outage or a required extension
  update. Every user depends on you redeploying fixes.
- Watch for abuse with `npm run logs`.

## Verify

```bash
curl -s https://<worker>/api/config
# {"registration":"open","emailVerification":true}
```
