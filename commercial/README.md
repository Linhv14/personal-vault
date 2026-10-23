# Commercial code

Everything under `commercial/` is covered by the
[7key Commercial License](../LICENSE_COMMERCIAL.md), not the AGPL. You may read,
modify and run it to develop, evaluate or audit 7key; production use needs a
subscription or the enterprise plan on 7key.online.

| Folder       | Contents                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| `core/`      | Pure helpers shared by the Worker and the clients: licence check, SSO model |
| `worker/`    | Worker routes for single sign-on, mounted by `src/worker/index.ts`          |
| `extension/` | Sign-in and admin screens, mounted through `extension/commercial.ts`        |
| `scripts/`   | `issue-license.ts`, which signs licence keys                                |

The AGPL code reaches this folder only through three seams, `src/worker/index.ts`,
`extension/commercial.ts` for the extension pages and
`extension/commercial-background.ts` for its service worker; ESLint
(`import/no-restricted-paths`) rejects any other import. Code here may import the core through the usual `#core`, `#worker`,
`#ext`, `#ui` and `#i18n` aliases, and is imported as `#commercial/*`.

See [Single sign-on](../docs/explanation/sso.md) for the design and
[Set up single sign-on](../docs/how-to/set-up-sso.md) for administrators.

## Licence keys

A licence key is `7key-license-v1.<payload>.<signature>`: the payload is
base64url JSON `{ licensee, seats, expiresAt, features }` and the signature is
Ed25519 over `7key-license-v1.<payload>`. The Worker checks it offline against
`LICENSE_PUBLIC_KEY` in `core/license-key.ts`.

Create the signing key once, on a trusted machine, and keep the private key out
of the repository (a password manager or an offline disk):

```sh
node commercial/scripts/issue-license.ts keygen --out ~/.config/7key/license-signing-key.pem
```

The command prints the public key; commit only that, in `core/license-key.ts`.
Issue a licence with:

```sh
LICENSE_SIGNING_KEY_FILE=~/.config/7key/license-signing-key.pem \
  node commercial/scripts/issue-license.ts issue --licensee "Acme Corp" --seats 50 --expires 2027-12-31
```

`test/fixtures/license-test-key.json` holds a key pair used only by the tests;
the Worker never trusts it outside a local test run, and a test checks that the
production public key differs from it.
