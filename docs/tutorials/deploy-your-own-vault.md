# Deploy your own vault

In this tutorial you deploy 7key to your own Cloudflare account, load the
extension into Chrome, create a vault, save a login with a 2FA code, and check
that the server holds nothing readable. It takes about ten minutes.

You need:

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
- Node.js 22 or newer (`node --version`).
- Chrome 116 or newer, or another Chromium browser.

## 1. Get the code

```bash
git clone https://github.com/Linhv14/personal-vault.git
cd personal-vault
npm ci
```

## 2. Deploy

```bash
npm run deploy
```

The first run opens a browser so you can sign in to Cloudflare, and asks which
account to use if you have several. Then it:

1. creates a D1 database named `vault` and applies the migrations;
2. generates three secrets and uploads them to the Worker;
3. builds and deploys the Worker;
4. rebuilds the extension with your Worker's address baked in.

When it finishes, it prints the Worker URL. It has also written
`.secrets.local.txt`, which holds two values you need:

- `REGISTRATION_TOKEN`: you will type it once, in step 4.
- `AT_REST_SECRET`: copy it into your password manager or onto paper **now**.
  If it is lost, every account on this Worker is locked out. Then delete it
  from the file. [Back up and restore](../how-to/back-up-and-restore.md)
  explains why.

## 3. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Choose **Load unpacked** and select the `dist/extension` folder.
4. Pin 7key from the puzzle-piece menu so its icon stays in the toolbar.

## 4. Create your vault

Open the 7key popup and choose **Create a new vault**. Enter:

- your email address, which is your account name;
- the `REGISTRATION_TOKEN` from `.secrets.local.txt`;
- a master password, twice.

You are not asked for a server address: the build already knows it.

> Nobody holds a copy of the master password, which is the point, so the server
> cannot reset it. Choose one you will remember, and create a recovery code in
> Settings → Security, the only way back in if you forget it (see
> [Recover a forgotten master password](../how-to/recover-a-forgotten-master-password.md)).

## 5. Save a login with a 2FA code

1. Press **+** and fill in a title, website, username and password. The wand
   button generates a strong password.
2. In the 2FA field, paste a setup key (a base32 string) or an `otpauth://`
   link. If the site shows a QR code in the current tab, press **Scan QR on
   this tab** instead.
3. Save. The list now shows the item with a 2FA code that refreshes every 30
   seconds. Click it to copy; the clipboard is cleared 30 seconds later.

## 6. Check what the server sees

Ask your database what it stores for that item:

```bash
npx wrangler d1 execute vault --remote -c .wrangler.local.toml \
  --command "SELECT id, substr(ciphertext, 1, 40) AS ciphertext FROM items"
```

You get an id and base64 noise. The site, username, password and 2FA secret
exist only inside that ciphertext, and the key to it never left your browser.

## Where to go next

- Use the vault on a second computer:
  [Add another device](../how-to/add-another-device.md).
- Turn on login suggestions on websites: **Settings → Suggest logins on
  websites**. [Autofill](../explanation/autofill.md) explains what that grants.
- Understand what you just trusted: [Threat model](../explanation/threat-model.md).
