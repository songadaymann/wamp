CREATE TABLE IF NOT EXISTS playfun_user_links (
  user_id TEXT PRIMARY KEY,
  ogp_id TEXT NOT NULL UNIQUE,
  player_id TEXT,
  game_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playfun_user_links_ogp
  ON playfun_user_links (ogp_id);
