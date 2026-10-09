CREATE TABLE lost_song_play_sessions (
  id TEXT PRIMARY KEY,
  identity_type TEXT NOT NULL CHECK(identity_type IN ('user','guest')),
  identity_id TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  expanded_room_id TEXT,
  owner_user_id TEXT,
  song_x REAL NOT NULL,
  song_y REAL NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  found_at TEXT
);
CREATE INDEX lost_song_session_expiry ON lost_song_play_sessions(expires_at);
CREATE INDEX lost_song_session_identity ON lost_song_play_sessions(identity_type,identity_id,recovery_hash,started_at);

CREATE TABLE guest_lost_songs (
  guest_id TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  owner_user_id TEXT,
  session_id TEXT NOT NULL,
  found_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expanded_room_id TEXT,
  PRIMARY KEY(guest_id,recovery_hash,room_id)
);
CREATE INDEX guest_lost_song_expiry ON guest_lost_songs(expires_at);

CREATE TABLE user_lost_songs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  source_session_id TEXT NOT NULL,
  found_at TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  xp_day TEXT NOT NULL,
  xp_amount INTEGER NOT NULL CHECK(xp_amount IN (0,5)),
  PRIMARY KEY(user_id,room_id)
);
CREATE INDEX user_lost_song_daily_xp ON user_lost_songs(user_id,xp_day,xp_amount);
