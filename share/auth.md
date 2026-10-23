# 7key auth.md

How software agents get access to 7key, a zero-knowledge password manager and
secrets store. Every secret is encrypted on a person's device; the server only
stores ciphertext and holds no key that opens it.

## Agent registration

7key does not offer agent self-registration. There is no `/agent/identity`
endpoint, no anonymous, `identity_assertion` (ID-JAG) or `service_auth`
registration, and no OAuth authorization server, so there is no
`agent_auth` metadata to discover.

The reason is the encryption model, not a missing feature: a credential issued
to an agent would only reach ciphertext. Decryption needs a key that a person
holds (their master password) or deliberately hands over (a repository key for
CI). An agent identity is therefore always registered by a person, with one of
the methods below.

## Audience

- AI coding agents (Claude Code, Codex, Cursor and similar) that call
  third-party APIs with a person's keys.
- CI jobs, such as GitHub Actions, that need a project's secrets at build or
  deploy time.
- Scripts that a signed-in person runs from a terminal.

## Methods

### 1. Local agent proxy (`7key agent`)

Registration: none. The person signs in with the CLI (`7key login`, or
`7key login --sso` for an organization that uses single sign-on), then starts
the agent through 7key:

```
7key agent -- claude
```

The agent receives placeholders such as `7key-ph-…` instead of real values. A
proxy on the person's machine swaps in the real value only in request headers
sent to the hosts allowed for that secret (up to 10 per secret, `*.example.com`
for subdomains), and scrubs the value from responses. The agent never holds a
7key credential or a secret.

### 2. GitHub Actions (OIDC)

Registration: a team admin links a repository to a project environment in the
7key console (Project → CI). The console seals the environment's key for a new
repository key in the browser and calls
`POST /api/orgs/:id/teams/:teamId/projects/:projectId/links` with the
repository, a branch or GitHub environment, and the sealed key. The admin
stores the repository key as the `SEVENKEY_KEY` Actions secret. Unlinking
(`DELETE …/links/:linkId`) stops the repository at once.

Credential: the job's GitHub Actions OIDC token, issued by
`https://token.actions.githubusercontent.com`. The workflow uses
`Linhv14/7key-action@v1` with `permissions: id-token: write`, or the CLI with
`SEVENKEY_LINK` and `SEVENKEY_KEY` set. 7key checks the issuer, audience,
repository and branch or environment against the link, and answers
`POST /api/ci/secrets` with ciphertext that only the repository key opens.

### 3. Person's session (CLI and scripts)

Registration: none. `7key login` keeps a session token in the operating
system's keychain. `7key run`, `7key read`, `7key inject` and `7key dotenv` use
it and decrypt on the machine. A session lasts at most 30 days, ends after 14
days without use, and can be revoked from the device list in Settings or with
`7key logout`. Inside `7key agent`, the session is set aside so the agent
cannot use it.

## Credential use

- Send every credential in the `Authorization` header as a bearer token, never
  in a URL or a request body.
- A token only grants access to ciphertext. Keys stay on the person's device or
  in the repository secret.
- Self-hosted servers work the same way at their own origin; pass `--server` to
  the CLI or `server` to the Action.

## Discovery

- API catalog: `/.well-known/api-catalog`
- OpenAPI description: `/openapi.json`, documentation at `/api-docs`
- Agent skill: `/.well-known/agent-skills/index.json`
- Security contact: `/.well-known/security.txt`
