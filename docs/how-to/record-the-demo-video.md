# Record the demo video

The landing page video, its posters and the Open Graph images are recorded from
the real console and popup running against a local Worker. The scripts live in
`tools/demo-video/` and need macOS with Google Chrome, Node 22, `ffmpeg` and
`cwebp` (`brew install ffmpeg webp`).

Nothing in the repository holds accounts or tokens. Each machine creates its own
local accounts and demo workspace, stored in gitignored `*.local.json` files.

## One-time setup

Start the Worker and build the extension:

```bash
npm run build
npm run dev
```

In a second terminal, create three local accounts (owner, member, admin) and
the Northwind workspace with its team, projects, secrets and domain:

```bash
cd tools/demo-video
npx tsx accounts.mts
node make-site.mjs
node proxy.mjs site 8793 &
npx tsx seed.mts
```

`accounts.mts` writes `accounts.local.json`, `seed.mts` writes
`demo.local.json` with the organization and project ids. Set
`REGISTRATION_TOKEN` if the local Worker uses a token other than
`token-dev-local`.

## Record

With the Worker and the proxy running:

```bash
./render.sh          # both languages
./render.sh en       # one language
```

Each run records the scenes in `scenes.mjs` through a headless Chrome
screencast, removes the secrets the recording added, and writes
`share/assets/demo-<locale>.mp4`, `.webm` and `demo-poster-<locale>.webp`.
Frames and intermediate files stay in `tools/demo-video/out/`.

The console shows `northwind.dev` names and emails instead of the local
`acme.test` accounts; `tidy.mjs` swaps them on screen during recording.

## Other images

| Command               | Output                                      |
| --------------------- | ------------------------------------------- |
| `node og.mjs out`     | `out/og-en.png`, `out/og-vi.png` (1200×630) |
| `node stills.mjs out` | `out/popup-en.png`, `out/popup-vi.png`      |

Copy the ones you want into `share/assets/`.

## When something fails

| Symptom                                  | Fix                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `Chrome did not expose a page on port …` | Another Chrome holds that debugging port. Quit it, or change the port in the script |
| The popup shows a locked vault           | Session tokens expired. Run `npx tsx refresh-tokens.mts` and `node make-site.mjs`   |
| Sign-in fails with too many sessions     | Each account keeps 20 sessions. Create fresh accounts with `accounts.mts`           |
| The popup looks out of date              | Run `npm run build` and `node make-site.mjs` again                                  |

## Brand icons

`tools/brand/render-icons.mts` draws the logo from `src/ui/logo.ts` into the
extension icons (16, 32, 48 and 128 px) and the inline logo of the emails:

```bash
npx tsx tools/brand/render-icons.mts
```

Run it after changing the logo; it needs Google Chrome.
