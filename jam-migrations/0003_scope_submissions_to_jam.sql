CREATE TABLE jam_submissions_next (
  id TEXT PRIMARY KEY,
  jam_slug TEXT NOT NULL,
  user_id TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  UNIQUE (jam_slug, user_id)
);

INSERT INTO jam_submissions_next (
  id,
  jam_slug,
  user_id,
  username,
  email,
  room_x,
  room_y,
  room_url,
  room_reference_input,
  room_claimed_at,
  rules_accepted,
  ip_hash,
  user_agent,
  turnstile_verified_at,
  created_at,
  updated_at
)
SELECT
  id,
  jam_slug,
  user_id,
  username,
  email,
  room_x,
  room_y,
  room_url,
  room_reference_input,
  room_claimed_at,
  rules_accepted,
  ip_hash,
  user_agent,
  turnstile_verified_at,
  created_at,
  updated_at
FROM jam_submissions;

DROP TABLE jam_submissions;
ALTER TABLE jam_submissions_next RENAME TO jam_submissions;

CREATE INDEX idx_jam_submissions_jam_created
  ON jam_submissions (jam_slug, created_at);

CREATE INDEX idx_jam_submissions_room
  ON jam_submissions (jam_slug, room_x, room_y);
