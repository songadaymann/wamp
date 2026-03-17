CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  owner_display_name TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  published_json TEXT,
  draft_title TEXT,
  published_title TEXT,
  draft_version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_courses_owner
  ON courses (owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS course_versions (
  course_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  published_by_user_id TEXT,
  published_by_display_name TEXT,
  PRIMARY KEY (course_id, version),
  FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  FOREIGN KEY (published_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_course_versions_publisher
  ON course_versions (published_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS course_room_refs (
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  room_order INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  room_version INTEGER NOT NULL,
  room_title TEXT,
  PRIMARY KEY (course_id, course_version, room_order),
  UNIQUE (course_id, course_version, room_id),
  FOREIGN KEY (course_id, course_version)
    REFERENCES course_versions (course_id, version) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_room_refs_room
  ON course_room_refs (room_id, room_version);

CREATE INDEX IF NOT EXISTS idx_course_room_refs_coordinates
  ON course_room_refs (room_x, room_y);

CREATE TABLE IF NOT EXISTS course_runs (
  attempt_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  goal_type TEXT NOT NULL,
  goal_json TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_display_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result TEXT NOT NULL,
  elapsed_ms INTEGER,
  deaths INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  collectibles_collected INTEGER NOT NULL DEFAULT 0,
  enemies_defeated INTEGER NOT NULL DEFAULT 0,
  checkpoints_reached INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (course_id, course_version)
    REFERENCES course_versions (course_id, version) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_runs_course_version_result
  ON course_runs (course_id, course_version, result);

CREATE INDEX IF NOT EXISTS idx_course_runs_user_result
  ON course_runs (user_id, result);
