-- A suspended account can still sign in and play, but nothing it sends is saved (F184).
ALTER TABLE users ADD COLUMN suspended_at TEXT;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;

-- One row per moderation action that changes or removes other people's work.
CREATE TABLE moderation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (action IN ('suspend', 'unsuspend', 'revert_edits', 'room_clear')),
  target_user_id TEXT,
  target_room_id TEXT,
  operator_label TEXT NOT NULL,
  reason TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_moderation_audit_user ON moderation_audit(target_user_id, created_at DESC);
