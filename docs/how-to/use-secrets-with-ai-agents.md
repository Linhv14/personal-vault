# Use secrets with AI agents

Let an AI coding agent, such as Claude Code, call APIs with your project's
secrets without the secrets ever entering its context. The agent sees a
placeholder; 7key swaps in the real value on the way out, and only to hosts you
allowed.

## 1. Allow hosts for each secret

In the console, open the project and the environment, then press the terminal
icon on a secret's row (**AI agent hosts**). List the hosts that may receive
it, one per line:

```
api.stripe.com
*.myshopify.com
```

`*.example.com` covers subdomains, not `example.com` itself. A secret without
hosts is never given to an agent, and variables pass through as plain values.
Rows with hosts show an **Agent** badge.

## 2. Run the agent through 7key

Download `7key.mjs` from the
[latest release](https://github.com/Linhv14/7key-action/releases/latest), then:

```bash
node 7key.mjs agent --email you@example.com --project "Payments API" --env Development -- claude
```

7key asks for your master password, shows which secrets go to which hosts, and
waits for your yes (`--yes` skips it). Pass `--org` when two organizations have
a project with the same name. The email and server are remembered in
`~/.config/7key/config.json`; the password never is.

Inside the session:

- each allowed secret is an environment variable holding a placeholder such as
  `7key-ph-3f9c…`, so `curl -H "Authorization: Bearer $STRIPE_SECRET_KEY"`
  just works;
- `HTTPS_PROXY` points at a proxy 7key runs on `127.0.0.1` for this session
  only; curl, Node, Python, Git and most SDKs honour it;
- requests to an allowed host have their placeholders replaced in the URL,
  headers (Basic authorization included) and body; the real value is never
  written to disk or shown;
- values that come back in a response, raw or JSON-, URL- or base64-encoded,
  are replaced by the placeholder again before the agent reads them;
- every other host is tunnelled untouched, so a placeholder sent there stays a
  placeholder.

The first use is written to the organization's activity log as "let an AI
agent use secrets of". The session ends with the command: the proxy stops, the
temporary certificate authority is deleted and the 7key session is signed out.

## How it works

7key signs in like the extension, opens the team key with your account key and
decrypts the environment on your machine; nothing about this changes for the
server, which still sees only ciphertext. To read and rewrite HTTPS requests to
allowed hosts, the proxy creates a certificate authority for the session (an
ECDSA key that lives only in memory) and points `NODE_EXTRA_CA_CERTS`,
`SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` and similar variables at it, for the
command's processes only. Nothing is added to your system's trust store.

## What it does not protect

- **What the agent does with the access.** It cannot read the key, but it can
  make any request to an allowed host, with your key's full permissions. Use a
  restricted key (Stripe restricted keys, scoped tokens) and allow as few hosts
  as possible.
- **Code that ignores the proxy.** A program that bypasses `HTTPS_PROXY` sends
  the placeholder, which fails rather than leaks.
- **A determined process on your machine.** The real values sit in the 7key
  process's memory for the session; anything that can read another process's
  memory as your user can read them.
- **Responses in other encodings.** Values echoed back compressed, split
  across fields or transformed some other way are not recognised.
