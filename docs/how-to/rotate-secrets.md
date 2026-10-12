# Rotate secrets

Replace a Worker secret that leaked, or that you want to retire. Every command
below sets a secret on the deployed Worker; the change applies within seconds
and needs no redeploy.

```bash
npx wrangler secret put <NAME> -c .wrangler.local.toml
```

The secrets differ in what a change breaks, so check the row before you rotate.

| Secret               | Safe to rotate | What a new value breaks                                                                                  |
| -------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `REGISTRATION_TOKEN` | Yes            | Nothing. Only account creation reads it.                                                                 |
| `RESEND_API_KEY`     | Yes            | Nothing, if the new key works. Codes fail to send while the key is wrong.                                |
| `EMAIL_PROBE_SECRET` | With care      | Restricted share links stop opening; pending sign-up and share codes become invalid; decoy salts change. |
| `AT_REST_SECRET`     | **No**         | Every login and every vault. See below.                                                                  |

## `REGISTRATION_TOKEN`

Generate a value and set it:

```bash
openssl rand -base64 24 | tr '+/' '-_' | tr -d '=' | npx wrangler secret put REGISTRATION_TOKEN -c .wrangler.local.toml
```

Existing accounts and devices are unaffected. Give the new value only to people
who should create an account.

## `RESEND_API_KEY`

Rotate when the key was exposed (pasted into a chat, committed, shown on screen):

1. In Resend, create a new key with **Sending access** limited to your domain.
2. Set it: `npx wrangler secret put RESEND_API_KEY -c .wrangler.local.toml`.
3. Check that mail still goes out. Resend accepts `delivered@resend.dev` as a
   test recipient:

   ```bash
   curl -s -X POST https://<worker>/api/auth/verify-email \
     -H 'Content-Type: application/json' -d '{"email":"delivered@resend.dev"}'
   # {"ok":true,"required":true}
   ```

4. In Resend, **revoke the old key**. Until you do, whoever saw it can send mail
   as your domain.
5. Confirm the old key is dead:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://api.resend.com/domains \
     -H 'Authorization: Bearer <old key>'
   # 401
   ```

## `EMAIL_PROBE_SECRET`

It keys every HMAC the server uses to avoid storing an identifier in the clear:
the decoy KDF salts returned for unknown emails, the hashes of share
recipients, the hashes of one-time codes, and the per-network registration
counter. A new value means:

- links restricted to specific emails can no longer be opened; their creators
  need to share again;
- codes already emailed stop working; users request a new one;
- the decoy salt for an unregistered email changes. Someone who recorded the
  old salt can tell that address is not registered, which is what the decoy
  exists to hide.

Rotate it only if it leaked, and expect those effects.

## `AT_REST_SECRET`

Do not rotate it. Stored auth key hashes and wrapped vault keys are sealed under
keys derived from it, and the Worker knows only one value at a time: with a new
one no login succeeds and no vault can be unwrapped. Rotation would need both
values live until every user has signed in again, and that is not implemented.

If it was lost, restore it from your offline backup:
[Back up and restore](back-up-and-restore.md).

A leaked secret exposes nothing by itself: the risk is someone holding it
**and** a copy of the database. With both, each master password can be guessed
offline at the cost of 600,000 PBKDF2-SHA256 iterations per guess. Changing a
master password afterwards does not help against a copy taken earlier, because
the vault key inside it does not change. Treat it as a breach: tell users, and
ask anyone whose master password is not strong to change the passwords stored
in their vault at the sites themselves.
