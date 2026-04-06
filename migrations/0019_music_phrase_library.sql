CREATE TABLE IF NOT EXISTS music_phrase_batches (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  room_title TEXT,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  creator_user_id TEXT,
  creator_principal_type TEXT,
  creator_agent_id TEXT,
  creator_display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (room_id, room_version),
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_phrase_batches_room_version
  ON music_phrase_batches (room_id, room_version);

CREATE TABLE IF NOT EXISTS music_phrases (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  room_title TEXT,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  creator_user_id TEXT,
  creator_principal_type TEXT,
  creator_agent_id TEXT,
  creator_display_name TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  label TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_key_tonic TEXT,
  source_key_mode TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (room_id, instrument_id, ordinal),
  FOREIGN KEY (batch_id) REFERENCES music_phrase_batches (id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_phrases_instrument_created
  ON music_phrases (instrument_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_music_phrases_room_instrument
  ON music_phrases (room_id, instrument_id, ordinal DESC);

CREATE TABLE IF NOT EXISTS music_phrase_sources (
  child_phrase_id TEXT NOT NULL,
  source_phrase_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (child_phrase_id, source_phrase_id),
  FOREIGN KEY (child_phrase_id) REFERENCES music_phrases (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_phrase_sources_source
  ON music_phrase_sources (source_phrase_id);
