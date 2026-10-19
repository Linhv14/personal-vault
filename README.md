# 7key

[![CI](https://github.com/Linhv14/personal-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/Linhv14/personal-vault/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[7key.online](https://7key.online)** · An end-to-end encrypted password manager with built-in 2FA codes, as a browser
extension backed by a Cloudflare Worker you deploy yourself. The server stores
ciphertext and holds no key that opens it.

- **End-to-end encrypted.** AES-256-GCM on your device; the server sees only
  ciphertext.
- **2FA codes in the extension**, refreshing on their own, so you stop reaching
  for your phone. Add them by pasting a setup key or scanning the QR code on the
  page.
- **Autofill, when you want it.** Off by default; suggests and fills matching
  logins, generates passwords in sign-up forms, offers to save new ones.
- **Share links** that expire after a time or a number of views, can be limited
  to specific email addresses, and carry a live 2FA code. The recipient
  installs nothing.
- **Team vaults** for passwords a family or a team shares: every member reads
  and edits them, and they are re-encrypted when someone leaves.
- **Your infrastructure.** Runs on your own Cloudflare account, inside the free
  tier for personal use. Optional open registration for a small shared server.
- **Works offline** from the encrypted copy on each device; syncs across them.
- **English and Vietnamese.**

## Quick start

You need a Cloudflare account, Node.js 22+, and Chrome 116+.

```bash
git clone https://github.com/Linhv14/personal-vault.git
cd personal-vault
npm ci
npm run deploy
```

Load `dist/extension` in `chrome://extensions` (Developer mode → Load unpacked),
choose **Create a new vault**, and use the registration token from
`.secrets.local.txt`. Back up `AT_REST_SECRET` from that file before anything
else.

The full walkthrough is [Deploy your own vault](docs/tutorials/deploy-your-own-vault.md).

## How it protects you

```
master password ─ PBKDF2-SHA256, 600k ─► master key
                                           ├─ HKDF "auth" ─► auth key ──► server (proves who you are)
                                           └─ HKDF "enc"  ─► wrapping key ─► unwraps the vault key
                                                                              └─ AES-256-GCM per item
```

The server learns your email, how many items you have and when they change. It
never learns site names, usernames, passwords, 2FA secrets or notes. Two limits,
stated plainly:

1. **A forgotten master password cannot be recovered.** Nobody holds a copy.
2. **Whatever app carries a share link can open it.** Add a link password and
   send it another way when that matters.

Details: [Cryptography](docs/explanation/cryptography.md) ·
[Threat model](docs/explanation/threat-model.md).

## Documentation

| I want to…                                    | Read                                                               |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Set it up for the first time                  | [Deploy your own vault](docs/tutorials/deploy-your-own-vault.md)   |
| Use it on another computer                    | [Add another device](docs/how-to/add-another-device.md)            |
| Host it for family or a team                  | [Run a shared server](docs/how-to/run-a-shared-server.md)          |
| Protect against data loss                     | [Back up and restore](docs/how-to/back-up-and-restore.md)          |
| Replace a leaked key                          | [Rotate secrets](docs/how-to/rotate-secrets.md)                    |
| Install a new release                         | [Upgrade a deployment](docs/how-to/upgrade.md)                     |
| Look up a command, setting, endpoint or limit | [Reference](docs/README.md#reference-facts-to-look-up)             |
| Understand the design                         | [Explanation](docs/README.md#explanation-why-it-is-built-this-way) |

Everything is indexed in [`docs/README.md`](docs/README.md).

## Project

- [Contributing](CONTRIBUTING.md): development setup and house rules.
- [Security policy](SECURITY.md): how to report a vulnerability.
- [Changelog](CHANGELOG.md).

## License

[MIT](LICENSE), without warranty. 7key has not had an independent security
audit yet.
