CREATE TABLE IF NOT EXISTS chat_ban_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  banned_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (banned_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_chat_ban_audit_created_at
  ON chat_ban_audit (created_at DESC, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_ban_audit_user_created_at
  ON chat_ban_audit (user_id, created_at DESC);

INSERT INTO chat_ban_audit (id, user_id, banned_by_user_id, created_at)
SELECT
  lower(hex(randomblob(16))),
  b.user_id,
  b.banned_by_user_id,
  b.created_at
FROM chat_bans b
WHERE NOT EXISTS (
  SELECT 1
  FROM chat_ban_audit audit
  WHERE audit.user_id = b.user_id
    AND audit.created_at = b.created_at
);
