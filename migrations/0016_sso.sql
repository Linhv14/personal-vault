CREATE TABLE sso_configs (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  identifier TEXT UNIQUE,
  issuer TEXT,
  client_id TEXT,
  client_secret TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  decryption TEXT NOT NULL DEFAULT 'master_password',
  require_sso INTEGER NOT NULL DEFAULT 0,
  single_org INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sso_domains (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  checked_at INTEGER,
  verified_at INTEGER,
  PRIMARY KEY (org_id, domain)
);

CREATE UNIQUE INDEX idx_sso_domains_verified ON sso_domains (domain) WHERE verified_at IS NOT NULL;

CREATE TABLE sso_states (
  state_hash TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  client_challenge TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sso_states_expires ON sso_states (expires_at);

CREATE TABLE sso_grants (
  grant_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('session', 'register')),
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  client_challenge TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sso_grants_expires ON sso_grants (expires_at);
