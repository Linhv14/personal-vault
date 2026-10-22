CREATE TABLE registration_counts (
  ip_hash TEXT NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);

CREATE INDEX idx_sessions_account ON sessions (account_id, created_at);
