ALTER TABLE rooms ADD COLUMN draft_title TEXT;
ALTER TABLE rooms ADD COLUMN published_title TEXT;

ALTER TABLE room_versions ADD COLUMN title TEXT;

ALTER TABLE user_stats ADD COLUMN total_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_stats ADD COLUMN total_deaths INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_stats ADD COLUMN total_collectibles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_stats ADD COLUMN total_enemies_defeated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_stats ADD COLUMN total_checkpoints INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_stats ADD COLUMN total_rooms_published INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS point_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  points INTEGER NOT NULL,
  breakdown_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (event_type, source_key)
);

CREATE INDEX IF NOT EXISTS idx_user_stats_total_points
  ON user_stats (total_points DESC, completed_runs DESC, total_rooms_published DESC);

CREATE INDEX IF NOT EXISTS idx_point_events_user_created_at
  ON point_events (user_id, created_at DESC);
