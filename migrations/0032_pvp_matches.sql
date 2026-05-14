CREATE TABLE IF NOT EXISTS pvp_matches (
  match_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  result TEXT NOT NULL,
  winner_user_id TEXT,
  loser_user_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  final_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pvp_match_players (
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_display_name TEXT NOT NULL,
  result TEXT NOT NULL,
  hearts_remaining INTEGER NOT NULL,
  lives_lost INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (match_id, user_id),
  FOREIGN KEY (match_id) REFERENCES pvp_matches (match_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_match_players_user_created
  ON pvp_match_players (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pvp_matches_finished
  ON pvp_matches (finished_at DESC);

ALTER TABLE user_stats ADD COLUMN pvp_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_stats ADD COLUMN pvp_losses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_stats ADD COLUMN pvp_draws INTEGER NOT NULL DEFAULT 0;
