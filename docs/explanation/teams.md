# Teams and CI secrets

7key is becoming a hosted service where companies keep secrets for their teams and
hand them to CI without the server ever being able to read them. This page is
the design; it grows with each phase.

## Model

```
Company ─ Team ─ Project ─ Environment (dev, staging, prod) ─ Secret
                    └─ linked GitHub repositories, each granted some environments
```

Company owners and admins manage people and billing. A team's members read and
write its secrets; admins who are in the team also create, change and delete
its projects. Admins who are not in a team cannot read its projects. Read-only
access per project comes later.

## Keys

| Key                           | Encrypts                                    | Held by                                                           |
| ----------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Account key pair (ECDH P-256) | Team keys wrapped for this account          | Private key sealed under the account's vault key                  |
| Team key                      | Project keys                                | Wrapped for each member's public key                              |
| Project key                   | Secrets of every environment in the project | Sealed under the team key, with the project name and environments |
| Repository key                | The environments a repository is granted    | Kept by the repository as a GitHub secret                         |

Wrapping for a public key is ECDH with a fresh ephemeral key, HKDF-SHA-256 over
the shared secret with both public keys as salt, and AES-256-GCM with a context
string naming what is wrapped as associated data, so a wrapped team key cannot
be passed off as another team's.

Removing a member creates new team and project keys and re-encrypts the
secrets: the person who left may have kept the old keys, and nothing else
guarantees they cannot read what is written later.

### Projects and secrets

A project is one record sealed under the team key: its name, its environments
(each with a random id and a name, Development, Staging and Production to start)
and its own random key. A secret is a name, a value and an optional note sealed
under the project key. Every seal names what it belongs to as associated data:
`personal-vault/project/<project>/<generation>` and
`personal-vault/secret/<project>/<generation>/<environment>/<secret>`. The server
cannot move a production secret into development, swap two secrets, or replay
one from an older key: the first open fails. The server also refuses to move a
secret's environment outright. It sees ids, counts and timestamps, never names.

### Secret history

Changing a secret keeps the previous ciphertext, with who wrote it and when, up
to the last five. They are sealed exactly like the secret, so only the team can
open them, and re-keying the team re-encrypts them with everything else. A
client too old to send them during a re-key makes the server drop the history
rather than keep values under a key that is being retired. Reading the history
is written to the activity log; restoring saves the old value as a new change.

### View-only members and protected environments

Each person in a team either **can edit** or **can view**. An admin picks it when
adding someone to the team and changes it from the team's member list. People
who can view read, copy, export and run with every secret in the team, see the
history and use the team vault, but the Durable Object refuses their writes and
deletes with `403 orgs.read_only`, and the extension shows the team vault as view
only. The setting belongs to the team, so a large team is managed in one place
rather than project by project.

An admin can also **protect** an environment, usually production, from the
project's menu. Everyone in the team still reads it; only admins change it, and
other writes or deletes there fail with `403 orgs.protected_environment`.

Admins and the owner always edit. Both rules are enforced by the server, not by
cryptography: everyone in a team holds the team key, because reading needs it.
Put a project in its own team when people must not read it at all.

### Variables and secrets

Each entry is either a variable or a secret, and the type is sealed with the
value. Variables (a public URL, a log level) show their value in the console.
Secrets stay masked; revealing one, copying one, or copying an environment that
contains one as `.env` is written to the activity log (`secret.injected` when
`7key agent` hands secrets to an AI agent, `secret.revealed`,
`secret.copied`, `secrets.exported`). The log entry comes from the client, so it
records what people do in the console, not a guarantee: anyone in the team holds
the project key and can decrypt every value. A secret that people cannot read at
all needs a key people do not have, which is what CI-only environments in phase
3 will be.

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
is refused if the team has moved on.

Re-keying also gives every project a new key and re-encrypts every secret of
the team on the admin's device, and the server swaps all of it in one
transaction: the team key, each project and each secret, refusing the set if a
project or secret is missing or extra. Until that happens, the team is flagged
and every write to its projects is refused, so nothing new is written under keys
the departed member holds.

## Team vaults

Each team also has a vault for logins, 2FA codes, passkeys, cards and notes,
shown in the popup next to the personal vaults, grouped by organization. Every
member of the team reads and edits it; autofill and passkeys use its items like
personal ones. A family or a small group shares passwords by creating an
organization with one team.

An item in a team vault is the same record as a personal item, sealed under the
team key with `personal-vault/team-item/<team>/<generation>/<item>` as
associated data, so the server cannot move it to another team, swap two items,
or pass an item from an older generation off as current. Moving an item between a personal vault and a team vault
writes it to the target first and then deletes it from the source; **Share
with a team** in a personal vault's menu moves every item at once. The server
stores ids, timestamps and who saved what; the activity log shows
`team.item_saved` and `team.item_deleted` against the team, without titles.

Items written by other members are treated with care:

- a password captured on a site, or a new passkey, is only ever saved into a
  personal item, never into a team item that happens to match the site and
  username, so a teammate cannot plant a login to catch it;
- suggestions and passkeys from a team vault name the vault and organization
  in the autofill menu;
- an item id is looked up in the personal vault first, and an id that appears
  twice is shown once, so a teammate cannot shadow or delete a personal item
  by reusing its id.

Removing someone from the team re-keys the vault with the projects: the admin's
device re-encrypts every item under the new key in the same transaction, and
until then writes are refused. Items that no longer open (written with a bad
key by a member on their way out) are deleted during the re-key rather than
blocking it. The popup keeps the sealed items and the
account's sealed private key on disk, so team vaults open offline after the
first sync; team and organization names are in that cache in clear, as they
are on the server. The popup remembers the highest key generation it has seen
for each team and ignores an older one, so a server cannot roll a team back to
a key a removed member still holds. Within one generation the server can still
serve an older copy of an item or withhold a deletion; it cannot alter or
invent an item. A team vault holds up to 1,000 items of up to 64 KB each, and
5 MB in all.

## Roles

The Worker and the organization's Durable Object enforce every row; the console
only hides what a role cannot use.

| Action                                                                 | Owner                | Admin                                                  | Member                                                          |
| ---------------------------------------------------------------------- | -------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| See the organization and its member list                               | yes                  | yes                                                    | yes                                                             |
| See team names                                                         | all                  | all                                                    | own teams                                                       |
| Read and write secrets                                                 | teams they are in    | teams they are in                                      | teams they are in, unless view only; protected environments: no |
| Read and write team vault items                                        | teams they are in    | teams they are in                                      | teams they are in                                               |
| Create, rename and delete projects and environments, link repositories | teams they are in    | teams they are in                                      | no                                                              |
| Create and delete teams, add and remove team members                   | yes                  | yes (adding needs a seat in the team, to wrap its key) | no                                                              |
| Invite                                                                 | admins and members   | members                                                | no                                                              |
| Remove members                                                         | anyone but the owner | members                                                | themselves (leave)                                              |
| Change roles, transfer ownership, set email domains                    | yes                  | no                                                     | no                                                              |
| Activity log, seat usage, pending invitations                          | yes                  | yes                                                    | no                                                              |

Any account can create an organization and owns up to ten
(`MAX_ORGS_PER_ACCOUNT`). Creating one is an account action, so it sits next to
the list of the account's organizations in Settings rather than inside any one
organization's settings.

## Transferring ownership

Ownership moves only to an admin who has finished setting up their account,
and, when email domains are set, whose address is allowed. The owner re-enters
their master password; the server checks it like a sign-in, so a session left
open on someone else's machine cannot give the organization away. The old owner
becomes an admin and keeps their teams; team keys do not change, because
ownership grants rights over people and settings, not access to secrets.

## Email domains

An owner can restrict an organization to a list of email domains. The check is
an exact match on the part after the last `@`, so `acme.com` does not admit
`eu.acme.com` or `acme.com.evil.io`; subdomains are listed separately. It runs
when an invitation is sent, when it is accepted and when an account is created
from it, so an invitation sent before the restriction cannot be used to get in
afterwards.

The list restricts, it never admits: nobody joins because of their domain alone,
which is why it needs no proof that the organization owns the domain. Members
already outside the list keep their access and are marked in the member list,
so removing them stays a deliberate decision.

## Limits

| Tier     | Seats (members plus pending invitations) | Teams |
| -------- | ---------------------------------------- | ----- |
| Default  | 5                                        | 3     |
| Extended | 500                                      | 200   |

The limits live in `PLAN_LIMITS` in `src/core/org-model.ts`, shared by the
Worker and the extension. An organization's tier is the `plan` column in D1
and is changed by hand. Lowering a limit never removes
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

How it is built:

- Each environment has its own key, derived from the project key with HKDF
  (`personal-vault/environment-key/<project>/<environment>`), and secrets are
  sealed under it. Handing a repository the Production key opens Production and
  nothing else. Secrets sealed earlier under the project key are re-sealed the
  first time an admin or member opens the project.
- Linking creates a key pair in the browser. The environment key is wrapped for
  its public key (context `personal-vault/link-key/<link>/<generation>`), the
  private key is shown once as `SEVENKEY_KEY`, and the server stores the public key,
  the wrapped key and the rule.
- `POST /api/ci/secrets` verifies the token against GitHub's published keys
  (issuer `token.actions.githubusercontent.com`, audience = this server's
  origin, expiry), then the rule, then returns the wrapped key and the sealed
  values of that environment. The read is logged with the repository and ref as
  the actor.
- Re-keying a team re-wraps every link's environment key under the new
  generation, so linked repositories keep working with the key they already
  have.
- The CLI (`cli/`) and the Action (`action/`, bundled to `action/dist`) share one
  client: they ask the runner for an OIDC token, call the endpoint, and decrypt
  locally.

Local development accepts tokens signed by `test/fixtures/ci-test-key.json`, and
only on `127.0.0.1` or `localhost`: `npm run dev` passes its public key and a
test issuer as variables, and production never has them.

## Architecture

| Layer         | Runs on                                                                                                           | Holds                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Clients       | Chrome extension (Preact), web dashboard (Preact, same UI kit), `7key` CLI and GitHub Action (TypeScript on Node) | Keys and plaintext, only while unlocked                                                                     |
| Edge API      | One Cloudflare Worker (Hono)                                                                                      | No state; authenticates, routes to the right store                                                          |
| Control plane | D1, shared                                                                                                        | Accounts, sessions, organizations, memberships, invitations, plans and billing, one-time codes, share links |
| Data plane    | One SQLite-backed Durable Object per tenant: `user:<accountId>` and `org:<orgId>`                                 | Vault items; teams, projects, environments, secrets, wrapped keys, repository links, audit log              |
| Email         | Resend                                                                                                            | Codes and invitations                                                                                       |

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
  control plane.

The Worker authenticates against the control plane and passes the verified
account and role to the object. The object checks membership again against its
own table, so a routing bug in the Worker cannot hand one tenant's request to
another tenant's data.

## Audit log

One path only: the organization's object appends every event in the same step
as the action it records, and each record carries the hash of the previous one,
so deleting or editing a record breaks every hash after it. The log stays in the
object for the life of the organization; there is no second copy to operate or
keep in step. An organization's object holds up to 10 GB, which at a few hundred
bytes per event is tens of millions of events. If a customer needs the log in
their own SIEM, an export endpoint reads it from the object.

Events carry identifiers, never secret values or names (names are encrypted
too): who (account, or repository and ref), what, which object, from where, when.

## Console and web dashboard

Organizations are managed in one console (`extension/console`): sidebar
navigation, a hash route per page (`#/<org>/projects/<project>/<environment>`),
tables, and an overview of each project that lines every secret up against every
environment. It runs in two places from the same code: as an extension page,
using the vault the extension already holds, and at `/app` on the service's own
domain, for admins who are not in the extension, built into `dist/public/app`
and served by the Worker. Signing
in derives the keys in the browser exactly as the extension does: the master
password and the vault key never leave the page. Keys and the session token
live only in the page's memory (no `localStorage`, no cookies), so a reload or
15 minutes without activity signs out. The page talks only to its own origin,
enforced by the site's Content Security Policy.

The trade-off is the usual one for web vaults: the server delivers the code
that handles the keys, so a compromised server could deliver code that leaks
them to anyone who signs in afterwards. The extension does not have this
exposure, because its code is installed, not fetched. See the threat model.

## CI trust, without overtrusting OIDC

GitHub's OIDC token is used to bind a request to a repository, ref and
environment, the usual pattern for workload identity. It is not
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
2. Projects, environments, secrets, re-keying on removal, fingerprints in the UI
   (done: a fingerprint check before adding someone to a team).
3. Repository links, the `7key` CLI and the GitHub Action.
4. Other targets (Cloudflare, Vercel), SSO and SCIM, billing.
