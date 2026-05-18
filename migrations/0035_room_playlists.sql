CREATE TABLE IF NOT EXISTS room_playlists (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (visibility IN ('public')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_playlists_owner_updated
  ON room_playlists (owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_playlists_slug
  ON room_playlists (slug);

CREATE TABLE IF NOT EXISTS room_playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  added_by_user_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  note TEXT,
  UNIQUE (playlist_id, room_id, room_version),
  FOREIGN KEY (playlist_id) REFERENCES room_playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, room_version) REFERENCES room_versions(room_id, version) ON DELETE CASCADE,
  FOREIGN KEY (added_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_playlist_items_playlist_position
  ON room_playlist_items (playlist_id, position ASC, added_at ASC);

CREATE INDEX IF NOT EXISTS idx_room_playlist_items_room
  ON room_playlist_items (room_id, room_version);
