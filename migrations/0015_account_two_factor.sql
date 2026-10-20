ALTER TABLE accounts ADD COLUMN totp_secret TEXT;
ALTER TABLE accounts ADD COLUMN totp_enabled_at INTEGER;
ALTER TABLE accounts ADD COLUMN totp_last_step INTEGER;
ALTER TABLE accounts ADD COLUMN totp_pending_secret TEXT;
ALTER TABLE accounts ADD COLUMN totp_pending_at INTEGER;

CREATE TABLE two_factor_backup_codes (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (account_id, code_hash)
);

CREATE TABLE two_factor_challenges (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locale TEXT
);

CREATE INDEX idx_two_factor_challenges_account ON two_factor_challenges (account_id);
