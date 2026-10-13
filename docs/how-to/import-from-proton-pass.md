# Import from Proton Pass

Move logins, notes and Wi-Fi passwords from Proton Pass into 1PW.

## Export from Proton Pass

1. Open Proton Pass in the browser extension or the web app. The mobile apps
   cannot export.
2. Go to **Settings → Export**.
3. Choose **JSON** or **CSV**. Do not choose the PGP-encrypted export: 1PW
   cannot read it without bundling an OpenPGP library into the extension.

JSON keeps more: **passkeys**, extra fields, every website of a login, and
whether an item is in the trash. CSV has no passkeys.

## Import into 1PW

1. Unlock 1PW.
2. Open **Settings → Data → Import passwords**, or press **Import from
   Proton Pass** on an empty vault. A page opens in a new tab;
   browsers close the popup when a file picker opens, so the import runs there.
3. Choose the exported file (`.zip`, `.json` or `.csv`).
4. Review the summary and press **Import**.
5. **Delete the export file.** It contains every password in plain text.

The file is read in the browser. Only encrypted items leave the device, in
batches of up to 100.

## What is imported

| Proton Pass                               | Becomes in 1PW                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Login                                     | Item with title, first website, username (or email), password and 2FA secret        |
| Extra websites                            | Listed in the note                                                                  |
| Email and username both set               | Username as the username, email in the note                                         |
| Extra fields                              | `name: value` lines in the note; an extra 2FA field is used if there is no main one |
| Note                                      | Item with only a title and note                                                     |
| Wi-Fi                                     | Item with the network name as username and its password                             |
| Alias, credit card, identity, other types | Skipped and counted                                                                 |
| Items in the trash                        | Skipped and counted (JSON only; CSV does not mark them)                             |

An item already in the vault, with the same website (or title), username and
password, is skipped, so importing the same file twice adds nothing. If that
item has no passkey and the export has one, the passkey is added to it: after
importing a CSV, import the JSON export to bring the passkeys over.

Passkeys keep their credential id, site and user handle, so the sites they
belong to accept them without signing up again.
