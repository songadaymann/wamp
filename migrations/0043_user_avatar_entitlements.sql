CREATE TABLE IF NOT EXISTS user_avatar_entitlements (
  user_id TEXT NOT NULL,
  avatar_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, avatar_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_avatar_entitlements_avatar
  ON user_avatar_entitlements (avatar_id, granted_at DESC);
