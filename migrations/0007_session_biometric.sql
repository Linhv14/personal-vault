-- Unlock with Touch ID or Windows Hello on one device. The device's platform
-- authenticator holds a key pair; bio_public_key verifies its signatures over a
-- one-time bio_challenge, and only then is bio_key released. The vault key stays
-- sealed on the device under bio_key and a secret that never leaves it.
ALTER TABLE sessions ADD COLUMN bio_credential TEXT;
ALTER TABLE sessions ADD COLUMN bio_public_key TEXT;
ALTER TABLE sessions ADD COLUMN bio_algorithm INTEGER;
ALTER TABLE sessions ADD COLUMN bio_rp_id TEXT;
ALTER TABLE sessions ADD COLUMN bio_origin TEXT;
ALTER TABLE sessions ADD COLUMN bio_key TEXT;
ALTER TABLE sessions ADD COLUMN bio_challenge TEXT;
ALTER TABLE sessions ADD COLUMN bio_challenge_expires INTEGER;
