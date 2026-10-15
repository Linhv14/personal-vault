# Use secrets in GitHub Actions

A workflow reads one environment of a project, for example Production of
"Payments API", without anyone pasting values into GitHub.

## Link the repository

1. Open the project in the console, then the **CI** tab.
2. Select **Link a repository**, enter `owner/repo`, choose the environment, and
   say where reads are allowed from: a branch (`main`) or a GitHub environment
   (`production`). Only admins who are in the project's team can link.
3. Copy **ONEPW_KEY** into the repository's secrets (Settings, Secrets and
   variables, Actions, New repository secret). The console shows it once and
   1PW does not keep it; if it is lost, unlink and link again.

## Add the step

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: Linhv14/personal-vault/action@main
        with:
          link: <the link shown in the console>
          key: ${{ secrets.ONEPW_KEY }}
      - run: ./deploy.sh
```

Every value becomes an environment variable for the later steps of the job.
Secret values are masked in the logs; variables are not. `id-token: write` lets
the job ask GitHub for the token that proves its repository and branch.

While the repository holding the Action is private, GitHub only lets workflows
in repositories of the same owner use it, and only after **Settings, Actions,
Access** allows it.

## Without the Action

`dist/cli/1pw.mjs` (from `npm run build`) does the same from a shell, with
`ONEPW_KEY` and `ONEPW_LINK` in the environment:

```bash
node 1pw.mjs run -- npm run deploy    # values only for this command
node 1pw.mjs env                      # values for the later steps
node 1pw.mjs dotenv > .env            # a .env file
```

## What is checked

The server answers only when GitHub's signature on the token is valid, the
token was issued for this server, the repository matches exactly, and the
branch or GitHub environment matches the link. `pull_request_target` runs are
refused. Every read appears in the activity log as the repository and ref.
Unlinking stops reads at once.
