# Publish to the Chrome Web Store

Ship the extension to people who will not build it themselves. A published
build signs in to **your** server by default, so publish only if you run a
shared server ([Run a shared server](run-a-shared-server.md)).

## Prerequisites

- A [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole)
  (one-time registration fee).
- A deployed Worker, and a privacy policy that matches it at a public URL.
- Screenshots at 1280×800 and a 440×280 small promo tile: the popup list, an
  item with its 2FA code, the console's secrets and, if you use them, team and
  AI agent features. Take them from the installed extension.

## Build the upload

```bash
npm run deploy      # make sure the baked-in server URL is current
npm run package
```

This writes `dist/7key-extension-<version>.zip` without the manifest's
`key` field, which the store refuses. The key stays in `extension/manifest.json`
so unpacked installs (development, the download on the site) keep the same
extension ID, and with it the same origin for device unlock. Its private half is
kept outside the repository; to keep that ID on the store, upload it once as
`key.pem` in the first submission's zip. Bump `version` in
both `package.json` and `extension/manifest.json` before each new upload; the
store rejects a version it has already seen.

## Fill in the dashboard

Everything the dashboard asks for, ready to paste.

### Store listing

**Name:** 7key

**Summary (≤132 characters):**
Passwords, 2FA codes and team secrets, end-to-end encrypted. AI agents use your API keys without ever seeing them.

**Description:**

> 7key keeps your passwords, 2FA codes and your team's API keys encrypted on
> your device. The server only stores ciphertext: nobody, including whoever runs
> it, can read your vault.
>
> - Passwords, notes, cards and addresses, encrypted with AES-256-GCM
> - 2FA codes built in, with recovery codes that keep count
> - Autofill and passkeys on websites, when you turn them on
> - Share a login through a link that expires after a time or a number of views
> - Shared vaults and per-environment project secrets for teams
> - A CLI and a GitHub Action for secrets in code and CI; AI agents use keys
>   through placeholders, and the real key only reaches the hosts you allow
> - Works offline; syncs across your computers

**Category:** Productivity · **Language:** English, Vietnamese

**Icon:** `extension/icons/icon-128.png`.

### Privacy practices

**Single purpose:** Store, generate and fill the user's own passwords and 2FA
codes, end-to-end encrypted.

**Permission justifications:**

| Permission                                       | Justification                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                        | Keeps the encrypted vault on the device for offline use, and the unlocked key in session memory only.                                                                                                                                                               |
| `unlimitedStorage`                               | Lets the encrypted copy of large personal and team vaults stay on the device for offline use, beyond the default 10 MB.                                                                                                                                             |
| `alarms`                                         | Locks the vault after the chosen idle time and clears copied secrets from the clipboard after 30 seconds.                                                                                                                                                           |
| `activeTab`                                      | Reads the address of the current tab to list matching logins, and captures it when the user asks to scan a 2FA QR code.                                                                                                                                             |
| `offscreen`                                      | Clears the clipboard after 30 seconds even when the popup has closed.                                                                                                                                                                                               |
| `clipboardWrite`                                 | Writes the empty value that clears a copied password from the clipboard.                                                                                                                                                                                            |
| `scripting`                                      | Registers the autofill and passkey scripts only after the user turns on "Autofill and passkeys on websites".                                                                                                                                                        |
| `identity`                                       | Opens the organization's identity provider in a browser window for "Sign in with SSO" (`chrome.identity.launchWebAuthFlow`) and receives the result at the extension's own `chromiumapp.org` address. It shows no install warning and reads no Google account data. |
| Optional host access `https://*/*`, `http://*/*` | Requested only when the user turns on autofill and passkeys, to show the fill icon in login forms, offer to save new logins, and create or use passkeys the user approves. Off by default.                                                                          |
| Optional `privacy`                               | Requested together with site access when the user turns on autofill, to turn off the browser's own offer to save passwords so only 7key asks; returned when they turn autofill off.                                                                                 |

**Remote code:** No. All code ships in the package.

Adding `identity` (for single sign-on) is a new permission: the Web Store
reviews the update again, but Chrome does not ask existing users to re-approve
the extension, since `identity` carries no permission warning.

**Data usage disclosures:**

- Collected: **Authentication information** (email as account name; passwords
  are stored only end-to-end encrypted) and **Website content** (login forms are
  read on the device when autofill is on; only logins the user saves leave the
  device, encrypted).
- Not sold, not used for anything unrelated to the single purpose, not used for
  creditworthiness or lending.

**Privacy policy URL:** the URL of that policy
