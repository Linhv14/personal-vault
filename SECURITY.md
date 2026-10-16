# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/Linhv14/personal-vault/security/advisories/new),
not in a public issue.

Include what an attacker needs (network position, an account, a copy of the
database), the steps to reproduce, and what they gain. A proof of concept
against a local deployment (`npm run dev`) is ideal; do not test against
servers you do not operate.

What to expect:

| Step                             | Target                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| Acknowledgement                  | Within 3 days                                                       |
| Assessment and severity          | Within 7 days                                                       |
| Fix for a critical or high issue | Within 30 days                                                      |
| Public advisory                  | When the fix is released, crediting you unless you prefer otherwise |

There is no bug bounty.

## Supported versions

Only the latest release receives security fixes. Every deployment is run by its
operator, so a fix reaches users only when the operator pulls it and redeploys
(see [Upgrade a deployment](docs/how-to/upgrade.md)). Advisories state whether
stored data is affected and whether users should change their master password.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Scope

In scope: the Worker, the extension, the share page, the build and deploy
scripts, and the cryptographic design.

Out of scope: weaknesses that need malware on an unlocked device, a lost master
password, the service that carries a share link reading it, and the other
limits stated in the [threat model](docs/explanation/threat-model.md). Reports
showing those limits are worse than documented are in scope.

## Audit status

7key has not had an independent security audit. If you need an audited password
manager, use Bitwarden or 1Password. What 7key offers instead is a codebase
small enough to read end to end, infrastructure you control, and a
[threat model](docs/explanation/threat-model.md) that says what it does not
protect.
