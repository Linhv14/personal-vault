-- revoke_hash lets whoever created a share delete it early without the share
-- recording who that was: the creator keeps the token, the server its hash.
ALTER TABLE shares ADD COLUMN revoke_hash TEXT;
ALTER TABLE shares ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0;

-- Recipients of a restricted share, as keyed hashes rather than addresses.
CREATE TABLE share_recipients (
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  PRIMARY KEY (share_id, email_hash)
);

CREATE TABLE share_codes (
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, email_hash)
);

CREATE INDEX idx_share_codes_expiry ON share_codes (expires_at);
