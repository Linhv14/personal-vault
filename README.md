# 7key

[![CI](https://github.com/Linhv14/personal-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/Linhv14/personal-vault/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

An end-to-end encrypted password manager with built-in 2FA codes and team
secrets: a Chrome extension, a web app and a CLI, backed by a Cloudflare Worker.
Use the hosted service at **[7key.online](https://7key.online)** or run the
server on your own Cloudflare account. Either way the server stores ciphertext
and holds no key that opens it.

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
- **Team secrets** per project and environment, for your terminal
  (`7key run`), CI (the GitHub Action) and AI agents (`7key agent -- claude`,
  which only ever sees placeholders).
- **Team vaults** for passwords a family or a team shares, re-encrypted when
  someone leaves. Single sign-on for organizations.
- **Your infrastructure, if you want it.** Self-hosting fits in Cloudflare's
  free tier for personal use.
- **Works offline** from the encrypted copy on each device; syncs across them.
- **English and Vietnamese.**

## Use it

### On 7key.online

Create an account at [7key.online/app](https://7key.online/app/). The extension
is not on the Chrome Web Store yet, so build it once; a fresh clone points at
7key.online:

```bash
git clone https://github.com/Linhv14/personal-vault.git
cd personal-vault
npm ci
npm run build
```

Then load `dist/extension` as in step 2 below and choose **Sign in to your
vault** in the popup.

### On your own server

You need a [Cloudflare account](https://dash.cloudflare.com/sign-up) (the free
plan is enough), Node.js 22 or newer and Chrome 116 or newer.

```bash
git clone https://github.com/Linhv14/personal-vault.git
cd personal-vault
npm ci
npm run deploy
```

`npm run deploy` signs you in to Cloudflare, creates the database and secrets,
deploys the Worker and builds the extension with your server's address. Then:

1. Copy `AT_REST_SECRET` from `.secrets.local.txt` somewhere offline, then
   delete it from the file. Without it, nobody can sign in to this server again.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load
   unpacked** and pick `dist/extension`.
3. In the popup, choose **Create a new vault** and enter the
   `REGISTRATION_TOKEN` from `.secrets.local.txt`.

Keep it up to date with one command, which backs up, pulls, reinstalls and
deploys:

```bash
npm run upgrade
```

The full walkthrough is [Deploy your own vault](docs/tutorials/deploy-your-own-vault.md);
[Run a shared server](docs/how-to/run-a-shared-server.md) opens it to family
or a team.

## Secrets in the terminal, CI and AI agents

```bash
npm install -g @7key/cli         # or: brew install linhv14/7key/sevenkey
7key login                       # self-hosted: 7key login --server https://<your worker>
7key link                        # once per folder: pick a project and environment
7key run -- npm run dev          # the command gets the secrets as variables
7key agent -- claude             # the agent gets placeholders, never the keys
```

In GitHub Actions, use [`Linhv14/7key-action`](https://github.com/Linhv14/7key-action).
See [Use the CLI](docs/how-to/use-the-cli.md),
[Use secrets in GitHub Actions](docs/how-to/use-in-github-actions.md) and
[Use secrets with AI agents](docs/how-to/use-secrets-with-ai-agents.md).

## How it protects you

```
master password ─ PBKDF2-SHA256, 600k ─► master key
                                           ├─ HKDF "auth" ─► auth key ──► server (proves who you are)
                                           └─ HKDF "enc"  ─► wrapping key ─► unwraps the vault key
                                                                              └─ AES-256-GCM per item
```

The server learns your email, how many items you have and when they change. It
never learns usernames, passwords, 2FA secrets or notes. With website icons on, it
sees a login's domain while it fetches that site's logo. Two limits, stated plainly:

1. **A forgotten master password can only be reset with a recovery code.** Nobody
   holds a copy of the password. Create a recovery code in Settings and keep it
   somewhere safe; without one, the vault cannot be opened.
2. **Whatever app carries a share link can open it.** Add a link password and
   send it another way when that matters.

Details: [Cryptography](docs/explanation/cryptography.md) ·
[Threat model](docs/explanation/threat-model.md).

## Documentation

| I want to…                                    | Read                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Set it up for the first time                  | [Deploy your own vault](docs/tutorials/deploy-your-own-vault.md)                                                |
| Use it on another computer                    | [Add another device](docs/how-to/add-another-device.md)                                                         |
| Use secrets from the terminal                 | [Use the CLI](docs/how-to/use-the-cli.md)                                                                       |
| Give CI or an AI agent its secrets            | [GitHub Actions](docs/how-to/use-in-github-actions.md) · [AI agents](docs/how-to/use-secrets-with-ai-agents.md) |
| Get back in after forgetting the password     | [Recover a forgotten master password](docs/how-to/recover-a-forgotten-master-password.md)                       |
| Host it for family or a team                  | [Run a shared server](docs/how-to/run-a-shared-server.md)                                                       |
| Sign an organization in with its IdP          | [Set up single sign-on](docs/how-to/set-up-sso.md)                                                              |
| Protect against data loss                     | [Back up and restore](docs/how-to/back-up-and-restore.md)                                                       |
| Replace a leaked key                          | [Rotate secrets](docs/how-to/rotate-secrets.md)                                                                 |
| Install a new release                         | [Upgrade a deployment](docs/how-to/upgrade.md)                                                                  |
| Look up a command, setting, endpoint or limit | [Reference](docs/README.md#reference-facts-to-look-up)                                                          |
| Understand the design                         | [Explanation](docs/README.md#explanation-why-it-is-built-this-way)                                              |

Everything is indexed in [`docs/README.md`](docs/README.md).

## Project

- [Contributing](CONTRIBUTING.md): development setup and house rules.
- [Security policy](SECURITY.md): how to report a vulnerability.
- [Changelog](CHANGELOG.md).

## License

Copyright (C) 2026 Linh BE. Licensed under the [GNU AGPL-3.0](LICENSE), without
warranty, except the `commercial/` directory (single sign-on and licence keys),
which falls under the [7key Commercial License](LICENSE_COMMERCIAL.md). See the
[licensing FAQ](LICENSE_FAQ.md) and the [trademark guidelines](TRADEMARKS.md).
Contributions are accepted under the [CLA](CLA.md). 7key has not had an
independent security audit yet.
