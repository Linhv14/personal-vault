# Trust1 Vault for GitHub Actions

Load one environment of a [Trust1 Vault](https://1pw.online) project into a
workflow. The job proves its repository and branch with GitHub's OIDC token;
the server answers with ciphertext that only the repository key opens. Secret
values are masked in the logs.

## Use

1. In the Trust1 Vault console, open the project, then **CI**, and link this
   repository to an environment.
2. Save the **TRUST1_KEY** it shows as a repository secret.
3. Add the step:

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

| Input    | Required | Description                                      |
| -------- | -------- | ------------------------------------------------ |
| `link`   | yes      | The repository link from the console             |
| `key`    | yes      | The repository key, stored as a secret           |
| `server` | no       | Your server, when it is not `https://1pw.online` |

## Without the Action

Each [release](https://github.com/Linhv14/trust1-vault-action/releases) carries
`trust1.mjs`, the same client as a single file for Node 20 or later, with its
SHA-256 sum. With `TRUST1_KEY` and `TRUST1_LINK` in the environment:

```bash
node trust1.mjs run -- npm run deploy    # values only for this command
node trust1.mjs env                      # values for the later steps of a job
node trust1.mjs dotenv > .env            # a .env file
```

## Versions

`@v1` follows the latest 1.x release. Pin a full version (`@v1.0.0`) or a
commit SHA to control upgrades.

This repository holds built files only; it is published from the Trust1 Vault
source on each release.
