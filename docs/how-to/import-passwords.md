# Import passwords

Move logins, notes, cards, addresses, Wi-Fi networks and passkeys from Proton
Pass, Bitwarden, 1Password or a browser into Trust1 Vault, and recovery codes from the
files sites give you.

## Export from the app you use now

### Proton Pass

In the browser extension or the web app (the mobile apps cannot export), open
**Settings → Export** and choose the **PGP-encrypted** export with a password.
Plain JSON works too. Both keep passkeys, extra fields, every website of a
login and the trash. CSV has no passkeys.

### Bitwarden

In the web vault, open **Tools → Export vault**; in the extension, **Settings →
Vault → Export vault**. Choose the **.json (Encrypted)** format with the
**Password protected** file type. Plain **.json** works too. Both keep cards,
identities, custom fields and passkeys; CSV keeps only logins and notes.

An **Account restricted** export can be opened only by Bitwarden itself, so
Trust1 Vault asks for a password-protected one instead. A password-protected export of
an account that uses Argon2id cannot be opened yet: export plain .json and
delete it after importing.

### 1Password

In the 1Password desktop app, open **File → Export**, choose the account and
the **1PUX** format. 1PUX keeps every category; CSV keeps only logins. 1Password
does not export passkeys.

### A browser or another manager

Export passwords as CSV. Trust1 Vault reads any CSV with a password column and a name or
website column, which covers Chrome, Edge, Firefox and Safari.

### Another Trust1 Vault account

Export an **Encrypted Trust1 Vault file** from the other account (see
[Export your vault](export-your-vault.md)) and enter its passphrase when asked.

### Recovery codes

Choose the file a site lets you download, such as `github-recovery-codes.txt`,
or a text or CSV file you saved the codes in. Trust1 Vault finds the codes among the
surrounding text, numbering and columns, and names the item after the file. To
type them in instead, add a **Recovery codes** item in the popup and paste the
codes as the site shows them.

## Import into Trust1 Vault

1. Unlock Trust1 Vault.
2. Open **Import / Export** from the popup menu (☰) or **Settings → Data**, or
   press **Import from another app** on an empty vault. A page opens in a new tab; browsers close the popup
   when a file picker opens, so the import runs there.
3. Choose the file (`.zip`, `.pgp`, `.json`, `.1pux`, `.csv` or `.txt`). Trust1 Vault
   recognises where it came from.
4. For an encrypted export, enter the password you set when exporting.
5. Review the summary and press **Import**.
6. Delete the export file. Unencrypted exports hold every password in plain
   text.

The file is read and decrypted in the browser. Only encrypted items leave the
device, in batches of up to 100.

## What is imported

| From                     | Becomes in Trust1 Vault                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Login                    | Login with title, websites, username, password, 2FA secret, passkey and password history |
| Extra fields             | Custom fields, hidden when they were hidden; a 2FA field is used if there is no main one |
| Note                     | Note                                                                                     |
| Credit card              | Card with name, number, expiry as `MM/YY`, security code and PIN                         |
| Identity                 | Address with name, contact details and postal address; the rest as fields                |
| Wi-Fi or wireless router | Wi-Fi with the network name and password                                                 |
| SSH key                  | SSH key with private key, public key and fingerprint                                     |
| Bank account             | Bank account                                                                             |
| Passport, ID, licence    | Document                                                                                 |
| Software licence         | Software license                                                                         |
| API credential           | API key                                                                                  |
| Other categories         | Note holding every field                                                                 |
| Recovery codes file      | One recovery codes item                                                                  |
| Alias, attached document | Skipped and counted                                                                      |
| Items in the trash       | Skipped and counted                                                                      |

An item already in the vault is skipped: a login with the same website (or
title), username and password, a card with the same number, or another item of
the same type with the same content, so importing the same file twice adds
nothing. If that login has no passkey and the export has one, the passkey is
added to it: after importing a CSV, import the JSON export to bring the
passkeys over.

Passkeys keep their credential id, site and user handle, so the sites they
belong to accept them without signing up again.

## How encrypted exports are opened

Both formats are decrypted with the browser's own cryptography rather than a
bundled library, and anything outside what is described here is reported as
unsupported instead of being guessed at.

- **Proton Pass** uses OpenPGP: a password-based key (iterated and salted S2K),
  AES with an integrity check (SEIPD v1), optional compression.
- **Bitwarden** derives a key with PBKDF2-SHA256 from the password and the
  file's salt, expands it with HKDF into an encryption and a MAC key, and seals
  the data with AES-256-CBC and HMAC-SHA256. Trust1 Vault checks the MAC before
  decrypting, so a wrong password is reported as such.
