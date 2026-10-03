-- Avoid scanning every snapshot for publisher counts and daily publish limits.
-- Include room_id so COUNT(DISTINCT room_id) can use the index alone.
CREATE INDEX IF NOT EXISTS idx_room_versions_publisher
  ON room_versions (published_by_user_id, created_at DESC, room_id);
