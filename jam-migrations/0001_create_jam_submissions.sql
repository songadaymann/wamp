CREATE TABLE IF NOT EXISTS jam_submissions (
  id TEXT PRIMARY KEY,
  jam_slug TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  room_url TEXT NOT NULL,
  room_reference_input TEXT NOT NULL,
  room_claimed_at TEXT NOT NULL,
  rules_accepted INTEGER NOT NULL CHECK (rules_accepted = 1),
  ip_hash TEXT,
  user_agent TEXT,
  turnstile_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jam_submissions_jam_created
  ON jam_submissions (jam_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_jam_submissions_room
  ON jam_submissions (jam_slug, room_x, room_y);
