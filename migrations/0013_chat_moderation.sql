ALTER TABLE chat_messages ADD COLUMN deleted_at TEXT;
ALTER TABLE chat_messages ADD COLUMN deleted_by_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_deleted_at
  ON chat_messages (deleted_at, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS chat_admins (
  user_id TEXT PRIMARY KEY,
  granted_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_chat_admins_created_at
  ON chat_admins (created_at DESC, user_id);

CREATE TABLE IF NOT EXISTS chat_bans (
  user_id TEXT PRIMARY KEY,
  banned_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (banned_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_chat_bans_created_at
  ON chat_bans (created_at DESC, user_id);
