# Use the CLI

The `7key` command gives your own commands, AI agents and CI the secrets of a
project, decrypted on the machine that runs them.

## Install

```bash
npm install -g @7key/cli               # Node 20 or later
brew install linhv14/7key/sevenkey     # or Homebrew
```

## Sign in and link a folder

```bash
7key login
cd ~/code/payments
7key link
```

`7key login` asks for your email and master password once. The session lasts
30 days and lives in the macOS Keychain, the Linux Secret Service keyring
(`secret-tool`), or, elsewhere, a file only you can read.

`7key link` lists your organizations, projects and environments and writes the
choice to `.7key.json`. The file holds names and ids, never a secret, so commit
it and teammates only need `7key login`. 7key looks for it in the current
folder and its parents.

## Run with secrets

```bash
7key run -- npm run dev          # secrets as environment variables
7key dotenv > .env               # or as a .env file
7key secrets                     # names and agent hosts, no values
7key run --env production -- npm run migrate
```

## Read one value or fill a template

```bash
7key read STRIPE_KEY                                  # linked project and environment
7key read 7key://payments-api/production/STRIPE_KEY   # <project>/<env>/<NAME>
7key inject -i config.yml.tpl -o config.yml
```

`7key read` prints the value alone, without a trailing newline when piped, so
`"$(7key read STRIPE_KEY)"` works in scripts. `7key inject` reads a template
from `-i` or standard input and replaces `{{ 7key:NAME }}` with a value from
the linked project and environment (or `--project` and `--env`), and
`{{ 7key://<project>/<env>/<NAME> }}` with a value from anywhere you have
access to. When a reference is unknown, it lists every one and writes nothing.
With `-o`, the file is created readable only by you; pass `--force` to replace
an existing one.

## Name a project without linking

`--org`, `--project` and `--env` take an id, a handle or the name:

| Form   | Example           | Notes                              |
| ------ | ----------------- | ---------------------------------- |
| id     | `8f0c2b1e-…`      | Survives renames; best for scripts |
| handle | `trust1-portal`   | The name, lowercase with dashes    |
| name   | `"Trust1 Portal"` | Case does not matter               |

```bash
7key run --project trust1-portal --env production -- ./deploy.sh
```

In the console, a project's **More** menu has **Copy CLI command** and **Copy
project ID**. When two projects share a handle, 7key asks for `--org` or the id.

## AI agents

```bash
7key agent -- claude
```

The agent gets placeholders instead of values, and a local proxy puts the real
value only into requests to the hosts allowed for each secret. While it runs,
your login is taken out of the keychain so the agent cannot use `7key run`. See
[Use secrets with AI agents](use-secrets-with-ai-agents.md).

## CI

In GitHub Actions, use the [7key Action](use-in-github-actions.md), or the CLI
with `SEVENKEY_LINK` and `SEVENKEY_KEY` set: `run`, `env` and `dotenv` then
authenticate with GitHub OIDC instead of a login.

## Sign out

```bash
7key whoami     # account, session expiry and linked project
7key logout     # revokes the session on the server and removes it locally
```

While you are logged in, any program you run can use the session, as it could
read a `.env` file. Log out on shared machines.
