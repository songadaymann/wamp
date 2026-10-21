-- Player reports of rooms, players, chat messages and guest rooms (F183).
-- target_label keeps what the reporter saw (a title, a name, a chat line), so evidence survives
-- a later edit or delete. reporter_hash is a salted hash (of the account, or of a guest's network);
-- reporter_user_id is kept for signed-in reporters but never returned by any API.
CREATE TABLE content_reports (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('room', 'user', 'chat_message', 'guest_room')),
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL,
  target_user_id TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('offensive', 'harassment', 'spam', 'cheating', 'other')),
  details TEXT NOT NULL DEFAULT '',
  reporter_user_id TEXT,
  reporter_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX idx_content_reports_status ON content_reports(status, created_at DESC);
CREATE INDEX idx_content_reports_target ON content_reports(target_type, target_id, status);
-- One open report per reporter and target; reporting again after a resolution is a new report.
CREATE UNIQUE INDEX idx_content_reports_once ON content_reports(target_type, target_id, reporter_hash)
  WHERE status = 'open';
