# Recover a forgotten master password

7key never sees your master password, so it cannot reset it for you. A
recovery code is the only way back in. Create one now, while you still know the
password.

## Create a recovery code

1. Open **Settings → Security → Recovery code** and press **Create recovery
   code**.
2. Enter your master password.
3. Copy or download the code and keep it somewhere offline: printed in a
   drawer, or in a different password manager. 7key shows it only once.

**Replace** makes a new code and stops the old one at once. **Remove** turns
recovery off.

Anyone with the code and your email address can set a new master password and
open your vault, so guard it like the password itself.

## Use it

1. In the 7key popup, press **Forgot master password?**, on the unlock screen
   or on the sign-in form.
2. Enter your email, the recovery code and a new master password.
3. 7key shows a new recovery code. The one you just used no longer works. Save
   the new one, then press **Saved, open my vault**.

Every device is signed out and must sign in with the new password. When the
server can send email, you also get a message saying the code was used.

## How it works

The code is 160 random bits. Your device derives two keys from it: one seals
your vault key, the other proves to the server that you hold the code. The
server stores the sealed vault key and an HMAC of the proof; neither can open
the vault. Recovery unseals the vault key on your device and re-wraps it under
the new password, so no item is re-encrypted and nothing in plaintext reaches
the server.
