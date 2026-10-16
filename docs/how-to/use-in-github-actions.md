# Use secrets in GitHub Actions

A workflow reads one environment of a project, for example Production of
"Payments API", without anyone pasting values into GitHub.

## Link the repository

1. Open the project in the console, then the **CI** tab.
2. Select **Link a repository**, enter `owner/repo`, choose the environment, and
   say where reads are allowed from: a branch (`main`) or a GitHub environment
   (`production`). Only admins who are in the project's team can link.
3. Copy **TRUST1_KEY** into the repository's secrets (Settings, Secrets and
   variables, Actions, New repository secret). The console shows it once and
   Trust1 Vault does not keep it; if it is lost, unlink and link again.

## Add the step

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: Linhv14/trust1-vault-action@v1
        with:
          link: <the link shown in the console>
          key: ${{ secrets.TRUST1_KEY }}
      - run: ./deploy.sh
```

Every value becomes an environment variable for the later steps of the job.
Secret values are masked in the logs; variables are not. `id-token: write` lets
the job ask GitHub for the token that proves its repository and branch.

The Action lives in the public repository
[`Linhv14/trust1-vault-action`](https://github.com/Linhv14/trust1-vault-action),
so any repository can use it. `@v1` follows the latest 1.x release; pin
`@v1.0.0` or a commit SHA to control upgrades. Add `server:` when your vault is
not `https://1pw.online`.

## Without the Action

Download `trust1.mjs` from the
[latest release](https://github.com/Linhv14/trust1-vault-action/releases/latest)
(Node 20 or later; the release lists its SHA-256). It does the same from a
shell, with `TRUST1_KEY` and `TRUST1_LINK` in the environment:

```bash
node trust1.mjs run -- npm run deploy    # values only for this command
node trust1.mjs env                      # values for the later steps
node trust1.mjs dotenv > .env            # a .env file
```

## What is checked

The server answers only when GitHub's signature on the token is valid, the
token was issued for this server, the repository matches exactly, and the
branch or GitHub environment matches the link. `pull_request_target` runs are
refused. Every read appears in the activity log as the repository and ref.
Unlinking stops reads at once.

## Publish a new version

From this repository, with the GitHub CLI signed in:

```bash
npm run publish:action -- 1.0.1
```

It builds, copies `action.yml`, the bundle and the README into the public
repository, tags `v1.0.1`, moves `v1`, and attaches `trust1.mjs` with its
checksum to a release.
