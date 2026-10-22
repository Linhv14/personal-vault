CREATE TABLE sso_links (
  org_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, account_id),
  FOREIGN KEY (org_id, account_id) REFERENCES org_members(org_id, account_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_sso_links_subject ON sso_links (org_id, issuer, subject);

ALTER TABLE sso_states ADD COLUMN link_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
