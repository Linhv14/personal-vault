# Contributing

## Getting set up

```bash
npm install
npm test
npm run preview        # the popup in a normal browser tab, no extension needed
```

`npm run preview` serves the real popup at <http://127.0.0.1:8788> against stubbed
`chrome.*` APIs and a seeded vault. Add `?screen=setup`, `?screen=unlock` or
`?locale=vi` to reach the other states.

Running against a real Worker:

```bash
npm run dev            # Worker + local D1 on http://127.0.0.1:8787
VAULT_E2E=1 npx vitest run test/e2e.test.ts
```

## Before opening a pull request

```bash
npm run typecheck      # two projects: browser and Worker
npm run format
npm test
```

CI runs exactly these, plus `npm run build`.

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

**Comment the decision, not the code.** A comment should record something a
reader would otherwise get wrong — why `HMAC-SHA1`, why a tombstone instead of
a DELETE. Comments restating the line below them get removed.

**Tests assert behaviour and invariants.** Prefer a test that pins a security
property (no plaintext in a request, key never in `storage.local`) over one that
pins an implementation detail. Assert on error codes, never on message text.

## Adding a language

1. Copy `src/i18n/vi.ts` to `src/i18n/<code>.ts` and translate the values.
2. Register it in `src/i18n/index.ts` under `LOCALES`, `LOCALE_NAMES` and
   `CATALOGUES`.
3. Run `npm test` — `test/i18n.test.ts` checks that every locale has the same
   keys and the same `{placeholders}` as English.

## Project layout

```
src/core/      Crypto, TOTP, generator, share payloads. WebCrypto only; runs in
               the browser, in Workers and in Node.
src/i18n/      Message catalogues. The UI edge, nothing below it is localized.
src/worker/    Hono Worker: auth, item sync, share links.
extension/     MV3 extension. The popup holds all the UI; the service worker
               only handles auto-lock, because MV3 terminates it when idle.
share/         The `/s/:id` page recipients open.
preview/       Harness that runs the popup as a web page for design review.
scripts/       Build, deploy and preview tooling.
```
