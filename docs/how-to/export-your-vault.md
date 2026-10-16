# Export your vault

Save a copy of your items to move them to another account, another password
manager, or an offline backup.

1. Unlock Trust1 Vault and open **Import / Export** from the popup menu (☰), then the
   **Export** tab.
2. If you have more than one vault, choose one or **All vaults**.
3. Choose a format:
   - **Encrypted Trust1 Vault file** (recommended): every item type, sealed with
     AES-256-GCM under a key derived from a passphrase you choose (PBKDF2,
     600,000 iterations). Only Trust1 Vault opens it, through **Import**.
   - **CSV for other apps**: logins only (name, website, username, password,
     note and the 2FA secret as an `otpauth://` link), in plain text. Browsers
     and most password managers import it.
4. For the encrypted file, enter a passphrase of at least 10 characters twice.
   It is not your master password, and nobody can open the file without it.
   For CSV, confirm that you understand the file is not encrypted.
5. Press **Export**. The browser saves the file to your downloads.

Items in the trash are left out. Vault names are not part of the file:
importing puts every item in the vault you are viewing.

Keep the encrypted file and its passphrase in different places. Delete a CSV
export as soon as you have imported it elsewhere: anyone who gets it reads
every password in it.
