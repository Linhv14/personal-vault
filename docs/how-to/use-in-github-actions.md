# Use secrets in GitHub Actions

A workflow reads one environment of a project, for example Production of
"Payments API", without anyone pasting values into GitHub.

## Link the repository

1. Open the project in the console, then the **CI** tab.
2. Select **Link a repository**, enter `owner/repo`, choose the environment, and
   say where reads are allowed from: a branch (`main`) or a GitHub environment
   (`production`). Only admins who are in the project's team can link.
3. Copy **SEVENKEY_KEY** into the repository's secrets (Settings, Secrets and
   variables, Actions, New repository secret). The console shows it once and
   7key does not keep it; if it is lost, unlink and link again.

## Add the step

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: Linhv14/7key-action@v1
        with:
          link: <the link shown in the console>
          key: ${{ secrets.SEVENKEY_KEY }}
      - run: ./deploy.sh
```

Every value becomes an environment variable for the later steps of the job.
Secret values are masked in the logs; variables are not. `id-token: write` lets
the job ask GitHub for the token that proves its repository and branch.

The Action lives in the public repository
[`Linhv14/7key-action`](https://github.com/Linhv14/7key-action),
so any repository can use it. `@v1` follows the latest 1.x release; pin
`@v1.0.0` or a commit SHA to control upgrades. Add `server:` when your vault is
not `https://7key.online`.

## Without the Action

The `7key` CLI does the same from a shell (Node 20 or later), with
`SEVENKEY_KEY` and `SEVENKEY_LINK` in the environment:

```bash
npx 7key run -- npm run deploy    # values only for this command
npx 7key env                      # values for the later steps
npx 7key dotenv > .env            # a .env file
```

Pin a version in CI, for example `npx 7key@1.3.1`.

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
repository, tags `v1.0.1`, moves `v1`, and attaches `7key.mjs` with its
checksum to a release.

Then publish the same CLI to npm and Homebrew, after `npm login`:

```bash
npm run publish:cli -- 1.0.1              # --dry-run to only pack and print
```

It publishes the `7key` package, then writes the `sevenkey` formula (with a
`7key` alias) built from that npm tarball to the `Linhv14/homebrew-7key` tap,
creating the tap the first time.
