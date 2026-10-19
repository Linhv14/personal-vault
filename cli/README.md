# 7key CLI

Give AI agents and CI the secrets they need, without ever showing them the
values. Part of [7key](https://7key.online), the end-to-end encrypted vault for
passwords, 2FA codes and team secrets.

## Install

```bash
npm install -g @7key/cli
```

```bash
brew install linhv14/7key/sevenkey
```

Or run it without installing: `npx @7key/cli <command>`. Needs Node 20 or later.

## Let an AI agent use your API keys

```bash
7key agent --project "Payments API" --env Development -- claude
```

The agent, here Claude Code, starts with a placeholder such as
`7key-ph-3f9c…` in place of each secret. A proxy that 7key runs on your machine
swaps in the real value only on requests to the hosts you allowed for that
secret, and hides it again if a response echoes it back. The agent can call
the API; it cannot read, print or send the key anywhere else.

```text
> Pull today's orders from our Shopify store
⏺ Bash(curl -H "X-Shopify-Access-Token: $SHOPIFY_ADMIN_TOKEN" https://northwind.myshopify.com/…)
  ⎿ 200 OK
```

1. In the [7key console](https://7key.online), open the secret and set its
   **AI agent hosts**, for example `api.stripe.com` or `*.myshopify.com`.
2. Run your agent through `7key agent`. You type your master password once,
   see which secret goes to which host, and confirm.
3. When the agent exits, the proxy stops and the session signs out.

Works with Claude Code, Codex, Cursor and any command-line tool that honours
`HTTPS_PROXY`: curl, Node, Python, Git and most SDKs.

| Option             | Meaning                                                |
| ------------------ | ------------------------------------------------------ |
| `--project <name>` | Project, as named in the console                       |
| `--env <name>`     | Environment, such as `Development`                     |
| `--org <name>`     | Organization, when several have a project of that name |
| `--email <addr>`   | Your 7key account; remembered after the first time     |
| `--server <url>`   | Your own 7key server instead of `https://7key.online`  |
| `--yes`            | Skip the confirmation                                  |

## Use secrets in CI

In GitHub Actions, the [7key Action](https://github.com/Linhv14/7key-action)
is the simplest. The CLI does the same from any shell, authenticated by GitHub
OIDC and the repository key shown in the console:

```bash
export SEVENKEY_LINK=<organization>.<link>   # SEVENKEY_KEY comes from a CI secret
7key run -- npm run deploy                   # values only for this command
7key env                                     # values for the later steps of the job
7key dotenv > .env                           # a .env file
```

## Security

- Secrets are decrypted on your machine; the 7key server only ever holds
  ciphertext.
- The agent proxy listens on `127.0.0.1` with a password of its own, swaps
  values into request headers only, and leaves hosts you did not allow
  untouched.
- Use a restricted key and allow as few hosts as possible: the agent cannot
  see the key, but it can still call the API with it.

[7key.online](https://7key.online) · MIT licensed
