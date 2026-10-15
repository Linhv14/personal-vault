-- Unlock with a PIN on one device. The extension keeps the vault key sealed
-- under a key built from the PIN and pin_key; pin_key is released only for the
-- right verifier, and only PIN_MAX_ATTEMPTS wrong tries are allowed before the
-- PIN is wiped. The verifier is stored as a keyed hash, never as sent.
ALTER TABLE sessions ADD COLUMN pin_verifier TEXT;
ALTER TABLE sessions ADD COLUMN pin_key TEXT;
ALTER TABLE sessions ADD COLUMN pin_attempts INTEGER NOT NULL DEFAULT 0;
