# Import from Proton Pass

Move logins, notes, cards, addresses and Wi-Fi networks from Proton Pass into
1PW.

## Export from Proton Pass

1. Open Proton Pass in the browser extension or the web app. The mobile apps
   cannot export.
2. Go to **Settings → Export**.
3. Choose the **PGP-encrypted** export and set a password for it. Plain JSON
   and CSV work too, but they leave every password readable in your Downloads
   folder.

The encrypted export and plain JSON keep **passkeys**, extra fields, every
website of a login, and whether an item is in the trash. CSV has no passkeys.

## Import into 1PW

1. Unlock 1PW.
2. Open **Settings → Data → Import passwords**, or press **Import from
   Proton Pass** on an empty vault. A page opens in a new tab;
   browsers close the popup when a file picker opens, so the import runs there.
3. Choose the exported file (`.zip`, `.pgp`, `.json` or `.csv`).
4. For an encrypted export, enter the password you set when exporting.
5. Review the summary and press **Import**.
6. Delete the export file. This matters most for JSON and CSV, which hold every
   password in plain text.

The file is read and, if encrypted, decrypted in the browser. Only encrypted
items leave the device, in batches of up to 100.

1PW reads the OpenPGP format Proton Pass uses for this export: a password-based
key (iterated and salted S2K), AES with an integrity check (SEIPD v1), optional
compression. It does this with the browser's own cryptography rather than an
OpenPGP library. Other OpenPGP variants are reported as unsupported instead of
being guessed at.

## What is imported

| Proton Pass                 | Becomes in 1PW                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Login                       | Item with title, first website, username (or email), password and 2FA secret        |
| Extra websites              | Listed in the note                                                                  |
| Email and username both set | Username as the username, email in the note                                         |
| Extra fields                | `name: value` lines in the note; an extra 2FA field is used if there is no main one |
| Note                        | Note                                                                                |
| Credit card                 | Card with name, number, expiry (`YYYY-MM` becomes `MM/YY`), security code and PIN   |
| Identity                    | Address with name, contact details and postal address; other details in the note    |
| Wi-Fi                       | Wi-Fi item with the network name and password                                       |
| Alias, other types          | Skipped and counted                                                                 |
| Items in the trash          | Skipped and counted (JSON only; CSV does not mark them)                             |

An item already in the vault is skipped: a login with the same website (or
title), username and password, a card with the same number, or another item of
the same type with the same content, so importing the same file twice adds nothing. If that
item has no passkey and the export has one, the passkey is added to it: after
importing a CSV, import the JSON export to bring the passkeys over.

Passkeys keep their credential id, site and user handle, so the sites they
belong to accept them without signing up again.
