CREATE TABLE IF NOT EXISTS school_classrooms (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  teacher_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_school_classrooms_teacher_email
  ON school_classrooms (teacher_email);

CREATE TABLE IF NOT EXISTS school_students (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_reset_required INTEGER NOT NULL DEFAULT 1,
  password_updated_at TEXT NOT NULL,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  FOREIGN KEY (classroom_id) REFERENCES school_classrooms (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_students_classroom_username_lower
  ON school_students (classroom_id, lower(username));

CREATE INDEX IF NOT EXISTS idx_school_students_user_id
  ON school_students (user_id);

