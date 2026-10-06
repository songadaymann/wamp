-- Keep only each player's best recorded run for an exact room version.
-- The payload is a bounded movement-only whitelist, separate from private audit traces.
CREATE TABLE run_ghosts (
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  elapsed_ms INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 300000),
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, room_version, user_id)
);
