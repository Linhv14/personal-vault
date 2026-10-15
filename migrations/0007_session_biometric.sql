ALTER TABLE sessions ADD COLUMN bio_credential TEXT;
ALTER TABLE sessions ADD COLUMN bio_public_key TEXT;
ALTER TABLE sessions ADD COLUMN bio_algorithm INTEGER;
ALTER TABLE sessions ADD COLUMN bio_rp_id TEXT;
ALTER TABLE sessions ADD COLUMN bio_origin TEXT;
ALTER TABLE sessions ADD COLUMN bio_key TEXT;
ALTER TABLE sessions ADD COLUMN bio_challenge TEXT;
ALTER TABLE sessions ADD COLUMN bio_challenge_expires INTEGER;
