# Contributing

Thanks for helping. Report bugs and ideas through the
[issue forms](https://github.com/Linhv14/personal-vault/issues/new/choose),
security problems privately as [SECURITY.md](SECURITY.md) explains, and follow
the [code of conduct](CODE_OF_CONDUCT.md).

## Releasing

Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version, bump
`version` in `package.json`, `package-lock.json` and `extension/manifest.json`,
commit, then push a tag such as `v0.5.0`. The Release workflow checks that the
tag matches, runs the tests, and publishes a GitHub release with the extension
zip (pointed at 7key.online), its SHA-256 sum and the changelog entry.

## Getting set up

```bash
npm install
npm test
```

Running against a real Worker:

```bash
npm run dev            # Worker + local D1 on http://127.0.0.1:8787
VAULT_E2E=1 npx vitest run test/e2e.test.ts
```

## Before opening a pull request

```bash
npm run lint
npm run knip
npm run typecheck
npm run format
npm test
npm run build
```

CI runs the same checks, with `npm run format:check` in place of
`npm run format`.

## House rules

**`src/core` takes no dependencies.** Anything added there sits in the path of
every password the user owns. If a task seems to need a library, weigh what it
would see — the QR decoder was dropped for this reason, in favour of Chrome's
built-in `BarcodeDetector`.

**`src/core` throws codes, not sentences.** Use `VaultError` with an
`ErrorCode`; the UI turns it into text. Add the matching `error.<code>` entry to
both `src/i18n/en.ts` and `src/i18n/vi.ts` — `vi` is typed against `en`, so a
missing key fails the build rather than silently falling back.

**User-visible strings live in the catalogues.** In HTML use `data-i18n`,
`data-i18n-placeholder` or `data-i18n-title`; in TypeScript call `t()`. A test
asserts that every `data-i18n` element renders non-empty.

**No comments in code, config or migrations.** Name things so the code reads
on its own. When a reader would otherwise get something wrong — why
`HMAC-SHA1`, why a tombstone instead of a DELETE — explain the decision in
`docs/explanation/` (or record the fact in `docs/reference/`), not in a comment.
`npm run lint` fails on any comment it finds; the only exceptions are tool
directives such as a shebang, `/// <reference />`, `// @vitest-environment`,
and the version notes Renovate keeps next to pinned actions in workflow files.

**Tests assert behaviour and invariants.** Prefer a test that pins a security
property (no plaintext in a request, key never in `storage.local`) over one that
pins an implementation detail. Assert on error codes, never on message text.

## Adding a language

1. Copy `src/i18n/vi.ts` to `src/i18n/<code>.ts` and translate the values.
2. Register it in `src/i18n/index.ts` under `LOCALES`, `LOCALE_NAMES` and
   `CATALOGUES`.
3. Run `npm test` — `test/i18n.test.ts` checks that every locale has the same
   keys and the same `{placeholders}` as English.

## Documentation

Docs follow [Diátaxis](https://diataxis.fr); [`docs/README.md`](docs/README.md)
is the map. When a change affects behaviour, update the page that describes it
in the same pull request:

- a new endpoint, error code, limit, setting or command goes in
  `docs/reference/`, which must match the code exactly;
- a new task an operator performs gets a page in `docs/how-to/`;
- the reasoning behind a design choice goes in `docs/explanation/`, not in a
  code comment;
- anything a user or operator notices goes in `CHANGELOG.md` under
  `Unreleased`.

## Project layout

See [Architecture](docs/explanation/architecture.md#code-layout).

## License and CLA

7key is licensed under the AGPL-3.0 (see [`LICENSE_FAQ.md`](LICENSE_FAQ.md)). By opening a
pull request you agree to the [Contributor License Agreement](CLA.md): add the line it asks
for to the description of your first pull request.
