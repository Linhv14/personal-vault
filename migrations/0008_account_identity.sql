-- Each account's key pair for sharing with teams. The public key is used by
-- others to wrap team keys for this account; the private key is stored only
-- sealed under the account's vault key, which the server never has.
ALTER TABLE accounts ADD COLUMN public_key TEXT;
ALTER TABLE accounts ADD COLUMN wrapped_private_key TEXT;
ALTER TABLE accounts ADD COLUMN identity_created_at INTEGER;
