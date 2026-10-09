-- Completed movement recordings live in private R2 objects. The small index
-- also acts as a durable upload outbox until R2 confirms the write.
CREATE TABLE run_ghost_archive (
  attempt_id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('room', 'guest_room')),
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  user_id TEXT,
  elapsed_ms INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes > 0 AND payload_bytes <= 300000),
  pending_payload_json TEXT CHECK (length(pending_payload_json) <= 300000),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((archived_at IS NULL AND pending_payload_json IS NOT NULL)
    OR (archived_at IS NOT NULL AND pending_payload_json IS NULL))
);
CREATE INDEX idx_run_ghost_archive_room
  ON run_ghost_archive (room_id, room_version, created_at DESC);
CREATE INDEX idx_run_ghost_archive_user
  ON run_ghost_archive (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_run_ghost_archive_pending
  ON run_ghost_archive (created_at, attempt_id) WHERE archived_at IS NULL;

-- Constant-time cost checks avoid scanning the growing run archive.
CREATE TABLE run_ghost_archive_totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload_bytes INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0
);
INSERT INTO run_ghost_archive_totals (id) VALUES (1);
CREATE TRIGGER run_ghost_archive_insert_totals AFTER INSERT ON run_ghost_archive
BEGIN
  UPDATE run_ghost_archive_totals
    SET payload_bytes = payload_bytes + NEW.payload_bytes, runs = runs + 1 WHERE id = 1;
END;
CREATE TABLE run_ghost_archive_usage (
  period_start TEXT PRIMARY KEY,
  uploads INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  alert_sent_at TEXT
);

-- Preserve the best recordings that already exist when archiving is enabled.
INSERT INTO run_ghost_archive
  (attempt_id, source_kind, room_id, room_version, user_id, elapsed_ms, deaths,
   object_key, payload_bytes, pending_payload_json, created_at)
SELECT attempt_id, 'room', room_id, room_version, user_id, elapsed_ms, deaths,
  'v1/room/' || attempt_id || '.json', length(CAST(payload_json AS BLOB)),
  payload_json, created_at
FROM run_ghosts WHERE length(CAST(payload_json AS BLOB)) <= 300000;
