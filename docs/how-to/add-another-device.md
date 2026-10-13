# Add another device

Use the same vault on a second computer or browser profile.

**You need:** your email, your master password, and an extension build that
points at your server.

## Steps

1. Install the extension on the new device: either copy `dist/extension` from
   the machine you deployed from and load it unpacked, or install the build you
   published (see [Publish to the Chrome Web Store](publish-to-chrome-web-store.md)).
2. Open the popup and choose **Sign in to your vault**.
3. Enter your email and master password.

No registration token is needed; it only gates creating accounts. The device
downloads the encrypted items and decrypts them locally.

### If the build points at someone else's server

A build made by another operator, such as a published 1PW extension, signs in to
their server by default. To use yours, press **Use your own server** under the
button and enter your Worker URL. `npm run status` prints it.

## What to expect

- Items, 2FA secrets and notes appear after the first sync.
- **Shared links** in Settings lists only links created on that device: the
  revoke tokens are kept on the device that made them.
- Language, auto-lock time and the autofill choice are per device.

## Removing a device

Choose **Settings → Account → Sign out** on it. That ends its session and
erases the encrypted copy of the vault from the device, keeping only language,
auto-lock and autofill preferences.

For a device you no longer have, **Settings → Security → Change master password** on any
other device revokes every session, so the lost device can no longer sync or
reach the server. It does not erase the encrypted copy already on that device:
someone holding the device and the **old** master password can still open what
was synced to it. If the device was stolen, treat the passwords stored before
the loss as exposed and change the important ones at their sites.
