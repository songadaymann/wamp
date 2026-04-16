CREATE TABLE IF NOT EXISTS background_image_uploads (
  id TEXT PRIMARY KEY,
  cloudflare_image_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  owner_display_name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  image_width INTEGER,
  image_height INTEGER,
  status TEXT NOT NULL DEFAULT 'upload_pending',
  moderation_status TEXT NOT NULL DEFAULT 'not_run',
  moderation_score REAL,
  moderation_labels_json TEXT,
  moderation_reason TEXT,
  moderation_model TEXT,
  upload_requested_at TEXT NOT NULL,
  uploaded_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_reason TEXT,
  cloudflare_deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_background_image_uploads_status_created
  ON background_image_uploads (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_background_image_uploads_owner_status
  ON background_image_uploads (owner_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS background_upload_permissions (
  user_id TEXT PRIMARY KEY,
  can_upload INTEGER NOT NULL DEFAULT 1,
  auto_approve INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
