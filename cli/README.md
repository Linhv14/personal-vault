# 7key CLI

Give AI agents and CI your secrets without letting them see them.

```bash
npm install -g 7key
```

or with Homebrew:

```bash
brew tap linhv14/7key && brew trust linhv14/7key && brew install linhv14/7key/7key
```

## AI agents

```bash
7key agent --email you@example.com --project "Payments API" --env Development -- claude
```

The agent gets a placeholder for each secret. A local proxy swaps in the real
value only on requests to the hosts you allowed for that secret in the
[7key console](https://7key.online), and hides it again in responses.

## GitHub Actions and CI

```bash
7key run --link <organization>.<link> -- npm test
```

The repository key is read from `SEVENKEY_KEY`. See
[7key.online](https://7key.online) for setup.
