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

## Use your secrets on your computer

```bash
7key login                  # once: email + master password, kept in the system keychain
cd ~/code/payments
7key link                   # once per folder: pick organization, project, environment
7key run -- npm run dev     # the command gets the secrets as environment variables
```

`7key link` writes `.7key.json`, which names the project and environment but
holds no secret, so you can commit it and teammates only need `7key login`.

| Command                         | What it does                                   |
| ------------------------------- | ---------------------------------------------- |
| `7key run -- <command>`         | Run a command with the linked secrets          |
| `7key dotenv > .env`            | Write them to a `.env` file                    |
| `7key secrets`                  | List the names, without values                 |
| `--env Production`              | Use another environment of the linked project  |
| `--project <name> --env <name>` | Use a project without linking the folder       |
| `7key whoami`, `7key logout`    | Show the account and link; sign out and revoke |

The session lasts 30 days. On macOS it lives in the Keychain, on Linux in the
Secret Service keyring (`secret-tool`), elsewhere in a file only you can read.
While you are logged in, any program you run can use it, just as it could read
a `.env` file. For AI agents, use `7key agent` below.

## Let an AI agent use your API keys

```bash
7key agent -- claude
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
2. Run your agent through `7key agent` in a linked folder. You see which
   secret goes to which host, and confirm. Without `7key login`, pass
   `--project` and `--env` and type your master password.
3. When the agent exits, the proxy stops and the session signs out.

Works with Claude Code, Codex, Cursor and any command-line tool that honours
`HTTPS_PROXY`: curl, Node, Python, Git and most SDKs.

While the agent runs, 7key takes your login out of the keychain and keeps it
in its own memory, so the agent cannot use `7key run` or read the keychain to
get real values. The login goes back when the agent exits.

| Option             | Meaning                                                |
| ------------------ | ------------------------------------------------------ |
| `--project <name>` | Project, as named in the console (instead of the link) |
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
