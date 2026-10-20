---
name: 7key-secrets
description: Use API keys and other secrets stored in 7key from a terminal, a CI job or an AI coding agent without printing or pasting their values.
---

# Using secrets from 7key

7key is a zero-knowledge password manager with per-environment project secrets. Values are
decrypted on the user's machine; the server only stores ciphertext. Follow these rules when
a task needs a secret.

## Rules

- Never ask the user to paste a secret into the conversation, and never print one.
- Prefer passing secrets to a process as environment variables with `7key run` over
  writing them to files.
- If you must write a file (`7key inject`, `7key dotenv`), do not commit it and do not read
  it back into the conversation.
- A human signs in. Do not try to run `7key login` with a password yourself.

## Check the setup

```
7key whoami     # account, session expiry and the linked project
7key secrets    # secret names and allowed agent hosts, no values
```

If `7key` is missing, ask the user to install it (`brew install linhv14/7key/sevenkey` or
`npm install -g @7key/cli`). If there is no session, ask the user to run `7key login`. If
the folder is not linked, ask them to run `7key link`.

## Run a command with secrets

```
7key run -- npm run dev
7key run --env production -- npm run migrate
7key run --project payments-api --env staging -- ./deploy.sh
```

## Read one value in a script

```
curl -H "Authorization: Bearer $(7key read STRIPE_KEY)" https://api.stripe.com/v1/charges
7key read 7key://payments-api/production/STRIPE_KEY
```

Use the command substitution directly; do not echo the value.

## Fill a template

```
7key inject -i config.yml.tpl -o config.yml
```

The template references values as `{{ 7key://<project>/<env>/<NAME> }}`. If any reference is
missing, nothing is written.

## When you are the AI agent

When the user started you with `7key agent -- <your command>`, your environment holds
placeholders such as `7key-ph-…` instead of real values. Use them exactly like real keys in
HTTP request headers. 7key swaps in the value only for hosts the user allowed for that
secret and removes it from responses. A placeholder in a URL or request body is not
replaced, and requests to other hosts get the placeholder, not the key. `7key run` is not
available inside an agent session by design.

## CI

In GitHub Actions use `Linhv14/7key-action@v1` with `permissions: id-token: write`; the
repository and branch must be linked to the project environment by a team admin.

More: https://7key.online/api-docs and https://7key.online/auth.md
