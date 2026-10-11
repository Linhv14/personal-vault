-- Initial schema. Every column holding user data is base64 ciphertext: the
-- server has no key to read it, and no reason to.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  -- KDF parameters are per account so a future move to Argon2id does not
  -- invalidate existing vaults.
  kdf_type TEXT NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  kdf_salt TEXT NOT NULL,
  -- A hash of the auth key, not the auth key. Neither can decrypt a vault.
  auth_key_hash TEXT NOT NULL,
  wrapped_vault_key TEXT NOT NULL,
  wrap_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Tombstone rather than a real DELETE: an offline device needs to learn that
  -- an item was removed, otherwise it syncs the item back on reconnect.
  deleted_at INTEGER
);

CREATE INDEX idx_items_sync ON items (account_id, updated_at);

CREATE TABLE sessions (
  -- Store the hash. A leaked database then yields no reusable tokens.
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  -- No account_id: a share must be readable by someone with no account, and
  -- omitting the link keeps the server from recording who shared with whom.
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  max_views INTEGER NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_shares_expiry ON shares (expires_at);

-- Blocks online password guessing. Offline guessing is not possible: it needs
-- wrapped_vault_key, which requires signing in first.
CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);
