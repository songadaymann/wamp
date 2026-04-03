ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_last_published_by_user_id
  ON rooms (last_published_by_user_id);
