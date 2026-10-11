-- Schema ban đầu. Mọi cột chứa dữ liệu người dùng đều là ciphertext base64:
-- server không có khoá để đọc, và cũng không cần đọc.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  -- KDF params lưu theo account để nâng lên Argon2id sau này mà không phá dữ liệu cũ.
  kdf_type TEXT NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  kdf_salt TEXT NOT NULL,
  -- Hash của auth key, không phải auth key. Auth key cũng không giải mã được vault.
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
  -- Tombstone, không DELETE thật: thiết bị đang offline cần biết item đã bị xoá,
  -- nếu không nó sẽ sync item đó trở lại ở lần kết nối sau.
  deleted_at INTEGER
);

CREATE INDEX idx_items_sync ON items (account_id, updated_at);

CREATE TABLE sessions (
  -- Lưu hash của token. Nếu DB bị đọc, token trong đó không dùng lại được.
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  -- Không có account_id: link share phải đọc được bởi người chưa đăng nhập, và
  -- không lưu liên kết tới account để server không tiết lộ ai share cho ai.
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  max_views INTEGER NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_shares_expiry ON shares (expires_at);

-- Chặn dò master password qua đường online. Dò offline là bất khả thi vì kẻ tấn
-- công cần wrapped_vault_key, mà muốn lấy nó thì phải đăng nhập được trước.
CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);
