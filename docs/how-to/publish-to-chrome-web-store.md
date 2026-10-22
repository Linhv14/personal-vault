# Publish to the Chrome Web Store

Ship the extension to people who will not build it themselves. A published
build signs in to **your** server by default, so publish only if you run a
shared server ([Run a shared server](run-a-shared-server.md)).

## Prerequisites

- A [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole)
  (one-time registration fee).
- A deployed Worker, and a privacy policy that matches it at a public URL.
- Screenshots at 1280×800: the popup list, an item with its 2FA code, the
  autofill menu on a login page, and the share page. Take them from the
  installed extension and a real login page.

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
End-to-end encrypted password manager with built-in 2FA codes, autofill and self-destructing share links.

**Description:**

> 7key keeps your passwords and 2FA codes encrypted on your device.
> The server only ever stores ciphertext: nobody, including whoever runs it, can
> read your vault.
>
> - Passwords and notes, end-to-end encrypted with AES-256-GCM
> - 2FA codes generated right in the extension, no phone needed
> - Suggests and fills logins on websites, and offers to save new ones (optional)
> - Strong password, passphrase and PIN generator
> - Share a login through a link that expires after a set time or number of views
> - Works offline from the copy on your device; syncs across your computers

**Category:** Productivity · **Language:** English, Vietnamese

**Icon:** `extension/icons/icon-128.png`.

### Privacy practices

**Single purpose:** Store, generate and fill the user's own passwords and 2FA
codes, end-to-end encrypted.

**Permission justifications:**

| Permission                                       | Justification                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                                        | Keeps the encrypted vault on the device for offline use, and the unlocked key in session memory only.                                                                                      |
| `unlimitedStorage`                               | Lets the encrypted copy of large personal and team vaults stay on the device for offline use, beyond the default 10 MB.                                                                    |
| `alarms`                                         | Locks the vault after the chosen idle time and clears copied secrets from the clipboard after 30 seconds.                                                                                  |
| `activeTab`                                      | Reads the address of the current tab to list matching logins, and captures it when the user asks to scan a 2FA QR code.                                                                    |
| `offscreen`                                      | Clears the clipboard after 30 seconds even when the popup has closed.                                                                                                                      |
| `clipboardWrite`                                 | Writes the empty value that clears a copied password from the clipboard.                                                                                                                   |
| `scripting`                                      | Registers the autofill and passkey scripts only after the user turns on "Autofill and passkeys on websites".                                                                               |
| Optional host access `https://*/*`, `http://*/*` | Requested only when the user turns on autofill and passkeys, to show the fill icon in login forms, offer to save new logins, and create or use passkeys the user approves. Off by default. |
| Optional `privacy`                               | Requested together with site access when the user turns on autofill, to turn off the browser's own offer to save passwords so only 7key asks; returned when they turn autofill off.        |

**Remote code:** No. All code ships in the package.

**Data usage disclosures:**

- Collected: **Authentication information** (email as account name; passwords
  are stored only end-to-end encrypted) and **Website content** (login forms are
  read on the device when autofill is on; only logins the user saves leave the
  device, encrypted).
- Not sold, not used for anything unrelated to the single purpose, not used for
  creditworthiness or lending.

**Privacy policy URL:** the URL of that policy
