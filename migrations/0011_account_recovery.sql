ALTER TABLE accounts ADD COLUMN recovery_auth_hash TEXT;
ALTER TABLE accounts ADD COLUMN recovery_wrapped_key TEXT;
ALTER TABLE accounts ADD COLUMN recovery_nonce TEXT;
ALTER TABLE accounts ADD COLUMN recovery_created_at INTEGER;
