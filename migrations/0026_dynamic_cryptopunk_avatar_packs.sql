CREATE TABLE IF NOT EXISTS cryptopunk_avatar_packs (
  punk_id INTEGER PRIMARY KEY,
  avatar_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  requested_by_user_id TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  generation_job_id TEXT,
  asset_base_url TEXT,
  manifest_url TEXT,
  head_image_url TEXT,
  base_texture_url TEXT,
  base_atlas_url TEXT,
  combat_texture_url TEXT,
  combat_atlas_url TEXT,
  punk_type TEXT,
  accessories_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  requested_at TEXT,
  generation_started_at TEXT,
  generated_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (punk_id >= 0 AND punk_id <= 9999),
  CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cryptopunk_avatar_packs_status
  ON cryptopunk_avatar_packs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cryptopunk_avatar_packs_requested_by
  ON cryptopunk_avatar_packs (requested_by_user_id, requested_at DESC);
