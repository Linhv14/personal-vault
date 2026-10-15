# Teams and CI secrets

1PW is becoming a hosted service where companies keep secrets for their teams and
hand them to CI without the server ever being able to read them. This page is
the design; it grows with each phase.

## Model

```
Company ─ Team ─ Project ─ Environment (dev, staging, prod) ─ Secret
                    └─ linked GitHub repositories, each granted some environments
```

Company owners and admins manage people and billing. A team's members see its
projects; each member reads or also writes. Admins who are not in a team cannot
read its projects.

## Keys

| Key                           | Encrypts                                    | Held by                                          |
| ----------------------------- | ------------------------------------------- | ------------------------------------------------ |
| Account key pair (ECDH P-256) | Team keys wrapped for this account          | Private key sealed under the account's vault key |
| Team key                      | Project keys                                | Wrapped for each member's public key             |
| Project key                   | Secrets of every environment in the project | Sealed under the team key                        |
| Repository key                | The environments a repository is granted    | Kept by the repository as a GitHub secret        |

Wrapping for a public key is ECDH with a fresh ephemeral key, HKDF-SHA-256 over
the shared secret with both public keys as salt, and AES-256-GCM with a context
string naming what is wrapped as associated data, so a wrapped team key cannot
be passed off as another team's.

Removing a member creates new team and project keys and re-encrypts the
secrets: the person who left may have kept the old keys, and nothing else
guarantees they cannot read what is written later.

### Re-keying

The server cannot make a new team key, so removal only flags the team. An
admin who is in the team then generates a fresh key on their device, wraps it
for every remaining member, and sends all of them at once with the next key
generation. The organization's object accepts the set only if it names exactly
the current members and the generation is the current one plus one, so a
member added or removed in the meantime, or two admins re-keying at the same
time, cannot leave someone with a stale key. Each generation has its own
wrapping context (`personal-vault/team-key/<team>/<generation>`; generation 0
keeps the original string), so a wrapped key from an older generation does not
open as the current one. Adding a member names the generation it wrapped for and
is refused if the team has moved on. Once projects exist (phase 2), re-keying
also re-wraps their keys under the new team key.

## Plans

| Plan | Seats (members plus pending invitations) | Teams |
| ---- | ---------------------------------------- | ----- |
| Free | 5                                        | 3     |
| Team | 500                                      | 200   |

The limits live in `PLAN_LIMITS` in `src/core/org-model.ts`, shared by the
Worker and the extension. An organization's plan is the `plan` column in D1;
until billing exists it is changed by hand. Lowering a limit never removes
anyone: an organization over it simply cannot add more.

## Ownership

An organization has one owner. The owner can hand ownership to any member, who
becomes owner while the previous owner becomes an admin, in one D1 batch and
one audit event. The owner cannot leave or be removed without handing it on
first.

## Trust in public keys

The server hands out the public keys. A malicious server could substitute its
own and receive the next team key wrapped for itself. Each member's key has a
fingerprint (the first 16 bytes of its SHA-256, as hex groups) that people
compare out of band when they join a team, as with Signal's safety numbers. A key
is stored once and never replaced, so a stolen session cannot swap it.

## CI

A linked repository proves who it is with GitHub's OIDC token (repository,
branch, environment), and the server checks that against the link's rules
before returning ciphertext. Decrypting needs the repository key, kept as a
GitHub secret. Either half alone is useless: the secret outside that
repository's workflow, the OIDC token without the secret, the server without
both. See "CI trust" below for what this does not protect against.

## Architecture

| Layer         | Runs on                                                                                                          | Holds                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Clients       | Chrome extension (Preact), web dashboard (Preact, same UI kit), `1pw` CLI and GitHub Action (TypeScript on Node) | Keys and plaintext, only while unlocked                                                                     |
| Edge API      | One Cloudflare Worker (Hono)                                                                                     | No state; authenticates, routes to the right store                                                          |
| Control plane | D1, shared                                                                                                       | Accounts, sessions, organizations, memberships, invitations, plans and billing, one-time codes, share links |
| Data plane    | One SQLite-backed Durable Object per tenant: `user:<accountId>` and `org:<orgId>`                                | Vault items; teams, projects, environments, secrets, wrapped keys, repository links, recent audit log       |
| Archive       | Basin Pipelines into R2 (Iceberg), partitioned by organization and day                                           | Long-term audit log, kept per plan                                                                          |
| Email         | Resend                                                                                                           | Codes and invitations                                                                                       |

Why this split:

- D1 caps a database at 10 GB and cannot be split later. The control plane
  holds metadata only (about 1 KB per account plus sessions), so it stays far
  below that; sessions move into the per-user object if it ever gets close.
- A Durable Object gives each tenant its own SQLite database (up to 10 GB),
  created on demand by name, with no binding per tenant. A query cannot reach
  another tenant's data because it is another database. Each object runs one
  request at a time, so re-keying a team or counting PIN tries needs no extra
  locking.
- Limits to design around: about 500 to 1,000 simple requests per second per
  object, 128 MB of memory, 2 MB per row, one location per object. No object
  serves everyone; there is no "global" object. Cross-tenant numbers live in the
  control plane or the archive.

The Worker authenticates against the control plane and passes the verified
account and role to the object. The object checks membership again against its
own table, so a routing bug in the Worker cannot hand one tenant's request to
another tenant's data.

## Audit log

Two tiers, because an audit log for secrets must not lose a record:

1. The organization's object appends every event in the same step as the action
   it records, with each record carrying the hash of the previous one and the
   object keeping the latest hash. Recent events (90 days) are served from here,
   instantly.
2. A copy goes to Basin Pipelines and lands in R2 as Iceberg tables, partitioned
   by organization and day, under a retention lock. This is the long-term record,
   queryable with SQL and exportable to a customer's SIEM. Pipelines can drop or
   delay events; the hash chain shows any gap, and the object re-sends it.

Events carry identifiers, never secret values or names (names are encrypted
too): who (account, or repository and ref), what, which object, from where, when.

## CI trust, without overtrusting OIDC

GitHub's OIDC token is used to bind a request to a repository, ref and
environment, as Vault, Infisical and 1Password's Workload Identity do. It is not
treated as enough on its own:

- Default deny. A link names one repository and exact refs or GitHub
  environments; no wildcards, no `pull_request_target`.
- Production environments require a GitHub environment with required reviewers.
- Tokens are short-lived; every fetch is audited and unusual ones raise alerts.
- Plain machine tokens remain for CI that is not GitHub.
- Once secrets are in a runner, any step in that job can read them (the
  `tj-actions/changed-files` compromise did exactly this). Pin actions to commit
  SHAs and keep secret-using jobs small.

## Phases

1. Account key pairs (done), per-tenant stores (vault items move to `user:<id>`),
   companies, teams, invitations, roles, audit log.
2. Projects, environments, secrets, re-keying on removal, fingerprints in the UI.
3. Repository links, the `1pw` CLI and the GitHub Action.
4. Other targets (Cloudflare, Vercel), SSO and SCIM, billing.
