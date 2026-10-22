# Linting boundaries

The application keeps direct console calls in `src/worker/log.ts` and
`extension/lib/log.ts`. These modules preserve structured Worker observability
and extension warning output while the rest of the application uses the shared
logging entry points. Command-line and maintenance scripts write their normal
user output to the console.

## No comments in code

Code, configuration and migrations carry no comments. A comment drifts from the
code it describes without any check noticing, and reasoning scattered across
files is hard to find when someone asks why the vault works the way it does.
The reasoning lives in `docs/explanation/` and the facts in `docs/reference/`,
where a change to behaviour updates them in the same pull request.

`npm run lint` runs `scripts/check-comments.ts` after ESLint. It reads every
tracked TypeScript and JavaScript file under the source folders with the
TypeScript parser, so `//` inside a string, a regular expression, a URL or a
template literal is never mistaken for a comment, and fails on any comment it
finds. It also rejects comment lines in `migrations/*.sql`, `wrangler.toml` and
`share/_headers`, and any `tsconfig` file that is not plain JSON. Generated and
vendored files (`dist/`, `action/dist/`, `tools/demo-video/site/`) are skipped.
Tool directives are allowed: a shebang, `/// <reference />`,
`// @vitest-environment`, `@ts-expect-error` and `eslint-disable`. Workflow
files are not checked, because Renovate reads the `# vX.Y.Z` note next to each
pinned action digest to know which release it is.

## Import boundaries

`import/no-restricted-paths` keeps the folders layered. `src/core` imports
nothing outside itself. `web/` reaches the extension only through
`extension/web-host.ts`, so the dashboard's dependency on the client app is one
reviewed file rather than a scattering of deep imports. `extension/settings` and
`extension/console` do not import each other; the pieces both need live in
`extension/ui/`. The one exception is `extension/console/main.tsx`, the entry
that mounts the settings pages inside the console. `extension/lib` does not
import UI modules, so background and content code never pull in Preact or the
DOM helpers by accident.

## One place for cryptography

`crypto.subtle` may only be called from `src/core/` and from a short list of
protocol adapters. Key derivation, hashing, HMAC and secret comparison go through
`src/core/primitives.ts` and `src/core/crypto.ts`, which are covered by RFC test
vectors, so a reviewer checking how keys are made reads one folder instead of
every caller.

The adapters keep their own calls because they implement someone else's wire
format rather than 7key's key hierarchy:

- `src/worker/at-rest.ts` seals data at rest with the server secret.
- `src/worker/webauthn.ts` and `src/worker/github-oidc.ts` verify signatures in
  formats defined by WebAuthn and GitHub's OIDC tokens.
- `extension/lib/passkey/authenticator.ts` signs WebAuthn assertions.
- `extension/lib/import/bitwarden.ts`, `openpgp.ts` and `proton-passkey.ts`
  decrypt or re-encode other password managers' exports.

ESLint's `no-restricted-properties` rejects `crypto.subtle` anywhere else.
