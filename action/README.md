# 7key for GitHub Actions

Load one environment of a [7key](https://7key.online) project into a
workflow. The job proves its repository and branch with GitHub's OIDC token;
the server answers with ciphertext that only the repository key opens. Secret
values are masked in the logs.

## Use

1. In the 7key console, open the project, then **CI**, and link this
   repository to an environment.
2. Save the **SEVENKEY_KEY** it shows as a repository secret.
3. Add the step:

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

| Input    | Required | Description                                       |
| -------- | -------- | ------------------------------------------------- |
| `link`   | yes      | The repository link from the console              |
| `key`    | yes      | The repository key, stored as a secret            |
| `server` | no       | Your server, when it is not `https://7key.online` |

## Without the Action

Each [release](https://github.com/Linhv14/7key-action/releases) carries
`7key.mjs`, the same client as a single file for Node 20 or later, with its
SHA-256 sum. With `SEVENKEY_KEY` and `SEVENKEY_LINK` in the environment:

```bash
node 7key.mjs run -- npm run deploy    # values only for this command
node 7key.mjs env                      # values for the later steps of a job
node 7key.mjs dotenv > .env            # a .env file
```

## Versions

`@v1` follows the latest 1.x release. Pin a full version (`@v1.0.0`) or a
commit SHA to control upgrades.

This repository holds built files only; it is published from the 7key
source on each release.
