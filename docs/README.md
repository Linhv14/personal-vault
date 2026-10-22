# 7key documentation

The documentation follows the [Diátaxis](https://diataxis.fr) framework: each
page answers one kind of question, so you can tell from where it lives whether
it teaches, instructs, describes or explains.

## Tutorials: learning by doing

| Page                                                        | You will end up with                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| [Deploy your own vault](tutorials/deploy-your-own-vault.md) | A Worker on your Cloudflare account and a working extension |

## How-to guides: a goal, the steps to reach it

| Page                                                                     | Goal                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [Add another device](how-to/add-another-device.md)                       | Use the same vault on a second computer or browser profile                             |
| [Import passwords](how-to/import-passwords.md)                           | Bring items from Proton Pass, Bitwarden, 1Password, a browser or a recovery codes file |
| [Export your vault](how-to/export-your-vault.md)                         | Save an encrypted 7key file or a CSV for another app                                   |
| [Use secrets in GitHub Actions](how-to/use-in-github-actions.md)         | Link a repository to an environment and read it from a workflow                        |
| [Use secrets with AI agents](how-to/use-secrets-with-ai-agents.md)       | Let Claude Code and other agents call APIs with keys they never see                    |
| [Run a shared server](how-to/run-a-shared-server.md)                     | Let other people sign up, with email verification and a domain                         |
| [Back up and restore](how-to/back-up-and-restore.md)                     | Survive a lost database, a bad deploy or a lost secret                                 |
| [Rotate secrets](how-to/rotate-secrets.md)                               | Replace a leaked token or API key without locking anyone out                           |
| [Upgrade a deployment](how-to/upgrade.md)                                | Move to a newer release safely                                                         |
| [Publish to the Chrome Web Store](how-to/publish-to-chrome-web-store.md) | Ship the extension to people who will not build it                                     |
| [Render the brand icons](how-to/render-the-brand-icons.md)               | Redraw the extension and email icons after the logo changes                            |
| [Run the browser tests](how-to/run-browser-tests.md)                     | Drive the real extension and console in Chromium against a local Worker                |

## Reference: facts to look up

| Page                                        | Contents                                                  |
| ------------------------------------------- | --------------------------------------------------------- |
| [Commands](reference/commands.md)           | Every `npm run` script and what it touches                |
| [Configuration](reference/configuration.md) | Deploy options, variables, secrets, bindings, local files |
| [HTTP API](reference/http-api.md)           | Endpoints, request and response bodies, error codes       |
| [Limits](reference/limits.md)               | Every quota, rate limit, size cap and timer               |
| [Data model](reference/data-model.md)       | D1 tables, what each column holds and what it reveals     |

## Explanation: why it is built this way

| Page                                        | Topic                                                          |
| ------------------------------------------- | -------------------------------------------------------------- |
| [Architecture](explanation/architecture.md) | Components, data flow, sync, and the code layout               |
| [Cryptography](explanation/cryptography.md) | Key hierarchy, algorithms, at-rest protection, KDF choice      |
| [Threat model](explanation/threat-model.md) | What each party can and cannot learn, and what is out of reach |

- [Teams and CI secrets](explanation/teams.md): the design for company teams and secrets in CI.
  | [Share links](explanation/share-links.md) | How a link carries its own key, and the controls on it |
  | [Autofill](explanation/autofill.md) | How the page script decides what to show and where |
  | [Passkeys](explanation/passkeys.md) | How 7key creates and uses passkeys, and what it refuses |
  | [Design decisions](explanation/design-decisions.md) | Choices that look odd, platform traps, tooling |

## Elsewhere in the repository

- [`README.md`](../README.md): what 7key is and the shortest path to running it.
- [`SECURITY.md`](../SECURITY.md): how to report a vulnerability.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md): development setup and house rules.
- [`CHANGELOG.md`](../CHANGELOG.md): what changed in each release.

## Conventions

- Commands assume the repository root and Node 22 or newer.
- `<worker>` stands for your Worker's address, such as
  `https://personal-vault.<subdomain>.workers.dev` or your own domain.
- Numbers quoted in explanations are defined once, in
  [Limits](reference/limits.md). If the two ever disagree, the code is right
  and the page is a bug.
