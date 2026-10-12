-- One pending sign-up code per address. code_hash is an HMAC under a Worker
-- secret, so a leaked table does not hand out codes; rows expire after 15
-- minutes and are purged by the hourly cron.
CREATE TABLE email_verifications (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);
