CREATE TABLE IF NOT EXISTS wamp_o_grams (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  creator_user_id TEXT,
  creator_principal_type TEXT,
  creator_agent_id TEXT,
  creator_display_name TEXT,
  recipient_name TEXT,
  recipient_email TEXT,
  sender_name TEXT,
  title TEXT,
  message TEXT,
  occasion TEXT,
  room_id TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  room_version INTEGER,
  room_status TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'draft',
  delivery_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wamp_o_grams_creator_created
  ON wamp_o_grams (creator_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wamp_o_grams_room
  ON wamp_o_grams (room_id, room_version);
