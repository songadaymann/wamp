ALTER TABLE users ADD COLUMN username TEXT;

UPDATE users
SET username = 'player-' || lower(substr(replace(id, '-', ''), 1, 12))
WHERE username IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (lower(username))
  WHERE username IS NOT NULL;
