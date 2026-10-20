# Run the browser tests

The Playwright suite in `e2e-browser/` loads the built extension into Chromium
and drives the real popup, autofill and console against a local Worker.

**You need:** Node 22 and the dependencies from `npm install`.

## Install the browser once

```sh
npx playwright install chromium
```

## Run

```sh
npm run test:browser
```

This builds the extension, starts its own Worker and runs every scenario:

- Sign up with the registration code, add a login, lock and unlock.
- Autofill on a local login page: the suggestion menu fills username and
  password, and the save prompt stores a new login after sign in.
- Console: create an organization, a team and a project; add, edit and delete
  secrets, open History, protect an environment and delete the project.
- Recovery code: create one, check it is shown and copy it.

Run one file with `npx playwright test autofill` once `npm run build` has run.

## What the suite sets up

- **Worker:** `e2e-browser/worker.ts` applies the D1 migrations and runs
  `wrangler dev` on `http://127.0.0.1:8789`, with state in
  `.wrangler/e2e-browser-state`. That folder is wiped at the start of every
  run, so it never touches the Worker from `npm run dev` on port 8787. The
  registration code is `token-dev-local`, as with `npm run dev`. Stop anything
  else on port 8789 first; the suite does not reuse a running server.
- **Extension:** `dist/extension` is copied to `e2e-browser/.artifacts/extension`
  and its manifest is changed there only: the extension pages may connect to
  the local Worker over plain HTTP, the autofill site access is granted up
  front (the same state as after **Turn on** autofill), and `clipboardRead`
  lets the recovery test read the copied code. Sign-up picks the server through
  **Use your own server**.
- **Accounts:** each test file signs up one fresh account and its tests run in
  order with it, which keeps the suite under the limit of 10 registrations per
  minute.
- **Login page:** autofill uses `http://localhost:8792/login`, answered by
  Playwright itself, so nothing listens on that port.

The browser runs headless: Playwright's `chromium` channel loads extensions in
headless mode.

## Debug a failure

- Watch it: `HEADED=1 npx playwright test vault`.
- Step through it: `npx playwright test vault --debug`.
- Failed tests keep a trace, screenshots and a page snapshot in
  `e2e-browser/.artifacts/results`. Open a trace with
  `npx playwright show-trace e2e-browser/.artifacts/results/<test>/trace.zip`,
  or the HTML report with
  `npx playwright show-report e2e-browser/.artifacts/report`.
- The autofill menu and save banner live in a closed shadow root that
  Playwright selectors cannot reach. `e2e-browser/shadow.ts` reads it through
  the Chrome DevTools Protocol and clicks with the real mouse, because the
  content script ignores synthetic clicks.

`e2e-browser/.artifacts` and `.wrangler` are gitignored. The suite is not part
of CI yet; `npm test` does not run it.
