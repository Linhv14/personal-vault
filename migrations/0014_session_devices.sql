ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
ALTER TABLE sessions ADD COLUMN device_label TEXT;

CREATE TABLE known_devices (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, label)
);
