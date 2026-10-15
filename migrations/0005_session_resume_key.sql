-- A random key per session that the extension uses to reopen the vault after a
-- browser restart. The key alone opens nothing: the extension keeps the sealed
-- vault key, and deleting the session (sign-out, expiry, password change)
-- makes that sealed copy useless.
ALTER TABLE sessions ADD COLUMN resume_key TEXT;
