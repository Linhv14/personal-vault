-- Caps how many accounts one address can create per day when registration is
-- open. ip_hash is an HMAC under a Worker secret, never the address itself, and
-- rows are purged by the hourly cron once their day is over.
CREATE TABLE registration_counts (
  ip_hash TEXT NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);

CREATE INDEX idx_sessions_account ON sessions (account_id, created_at);
