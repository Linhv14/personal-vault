# 7key auth.md

How software agents get access to 7key. 7key is a zero-knowledge password manager:
every secret is encrypted on the user's device, and the server only stores ciphertext.
An agent therefore never registers with the server on its own and never receives a
credential that can decrypt a vault without a person granting it.

There is no OAuth authorization server and no self-service agent registration endpoint.
Access is always provisioned by a human account holder through one of the methods below.

## Audience

- AI coding agents (Claude Code, Codex and similar) that call third-party APIs with a
  user's keys.
- CI jobs, such as GitHub Actions, that need a project's secrets at build or deploy time.
- Scripts run by a signed-in user from the terminal.

## Methods

### 1. Local agent proxy (`7key agent`)

The user signs in with the CLI (`7key login`, master password and, when enabled, a
two-factor code), then starts the agent through 7key:

```
7key agent -- claude
```

The agent receives placeholders such as `7key-ph-…` instead of real values. A local proxy
swaps in the real value only in requests to hosts the user allowed for that secret, and
scrubs the value from responses. The agent never holds a 7key credential or a secret.

Docs: https://7key.online/api-docs (HTTP API) and the `7key agent --help` output.

### 2. GitHub Actions (OIDC)

A team admin links a repository and branch to a project environment. The workflow uses
`Linhv14/7key-action@v1` with `permissions: id-token: write`. Each request carries the
GitHub Actions OIDC token as `Authorization: Bearer <token>`; 7key checks the issuer,
repository and branch against the link and returns ciphertext that only the repository's
key (stored as the `SEVENKEY_KEY` Actions secret) can open.

Endpoint: `POST https://7key.online/api/ci/secrets` (see the HTTP API reference).

### 3. User session (CLI and scripts)

`7key login` stores a session token in the operating system keychain. Commands such as
`7key run`, `7key read` and `7key inject` use that session with
`Authorization: Bearer <session token>` and decrypt locally. Sessions expire after 14 days
without use and can be revoked from the extension's device list.

## Credential use

- Send credentials only in the `Authorization` header as a bearer token.
- Never place a session token or OIDC token in a URL.
- Tokens grant access to ciphertext only; decryption keys stay on the user's device or in
  the repository secret.

## Discovery

- API catalog: https://7key.online/.well-known/api-catalog
- OpenAPI: https://7key.online/openapi.json
- Security contact: https://7key.online/.well-known/security.txt
