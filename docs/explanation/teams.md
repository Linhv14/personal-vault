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
both.

## Phases

1. Account key pairs (done), companies, teams, invitations, roles, audit log.
2. Projects, environments, secrets, re-keying on removal, fingerprints in the UI.
3. Repository links, the `1pw` CLI and the GitHub Action.
4. Other targets (Cloudflare, Vercel), SSO and SCIM, billing.
