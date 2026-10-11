-- Compact per-version facts for leaderboard lineage and rating windows (F026).
-- Filled lazily from room_versions.snapshot_json the first time a room's ranking data
-- is read, and recomputed when facts_version changes. Safe to drop and rebuild.
CREATE TABLE IF NOT EXISTS room_version_facts (
  room_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  facts_version INTEGER NOT NULL,
  facts_json TEXT NOT NULL,
  change_from_previous REAL NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (room_id, version),
  FOREIGN KEY (room_id, version) REFERENCES room_versions (room_id, version) ON DELETE CASCADE
);
