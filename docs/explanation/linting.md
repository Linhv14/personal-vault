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
