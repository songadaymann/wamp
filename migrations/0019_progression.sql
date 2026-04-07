CREATE TABLE IF NOT EXISTS pxp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  breakdown_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pxp_events_user_created
  ON pxp_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bxp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  breakdown_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bxp_events_user_created
  ON bxp_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cxp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  breakdown_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cxp_events_user_created
  ON cxp_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trust_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  breakdown_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trust_events_user_created
  ON trust_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id TEXT PRIMARY KEY,
  total_pxp INTEGER NOT NULL DEFAULT 0,
  total_bxp INTEGER NOT NULL DEFAULT 0,
  total_cxp INTEGER NOT NULL DEFAULT 0,
  player_level INTEGER NOT NULL DEFAULT 1,
  builder_level INTEGER NOT NULL DEFAULT 1,
  curator_level INTEGER NOT NULL DEFAULT 1,
  hidden_trust_score INTEGER NOT NULL DEFAULT 0,
  trust_tier_internal TEXT NOT NULL DEFAULT 'T0',
  founder_number INTEGER UNIQUE,
  badge_count INTEGER NOT NULL DEFAULT 0,
  trophy_count INTEGER NOT NULL DEFAULT 0,
  first_identity_qualified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_progress_founder
  ON user_progress (founder_number);

CREATE TABLE IF NOT EXISTS room_ratings (
  room_id TEXT NOT NULL,
  lineage_key TEXT NOT NULL,
  version_key INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  quality_stars INTEGER,
  difficulty_choice TEXT,
  auto_difficulty_choice TEXT,
  trust_weight REAL NOT NULL DEFAULT 1,
  completed_attempt_id TEXT,
  first_rated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rewarded_at TEXT,
  PRIMARY KEY (room_id, version_key, user_id),
  FOREIGN KEY (room_id, version_key)
    REFERENCES room_versions (room_id, version) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_ratings_room_version
  ON room_ratings (room_id, version_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_ratings_user
  ON room_ratings (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS course_ratings (
  course_id TEXT NOT NULL,
  lineage_key TEXT NOT NULL,
  version_key INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  quality_stars INTEGER,
  difficulty_choice TEXT,
  auto_difficulty_choice TEXT,
  trust_weight REAL NOT NULL DEFAULT 1,
  completed_attempt_id TEXT,
  first_rated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rewarded_at TEXT,
  PRIMARY KEY (course_id, version_key, user_id),
  FOREIGN KEY (course_id, version_key)
    REFERENCES course_versions (course_id, version) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_ratings_course_version
  ON course_ratings (course_id, version_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_course_ratings_user
  ON course_ratings (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS badge_awards (
  user_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  metadata_json TEXT,
  awarded_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_badge_awards_awarded_at
  ON badge_awards (awarded_at DESC);

CREATE TABLE IF NOT EXISTS content_trophies (
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  version_key INTEGER NOT NULL,
  trophy_type TEXT NOT NULL,
  metric_value REAL NOT NULL DEFAULT 0,
  weighted_vote_count REAL NOT NULL DEFAULT 0,
  awarded_at TEXT NOT NULL,
  PRIMARY KEY (content_type, content_id, version_key, trophy_type)
);

CREATE INDEX IF NOT EXISTS idx_content_trophies_content
  ON content_trophies (content_type, content_id, awarded_at DESC);

CREATE TABLE IF NOT EXISTS room_version_attribution (
  room_id TEXT NOT NULL,
  version_key INTEGER NOT NULL,
  prior_version_key INTEGER,
  percent_change REAL NOT NULL,
  contributor_weight_breakdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, version_key),
  FOREIGN KEY (room_id, version_key)
    REFERENCES room_versions (room_id, version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_version_attribution_room
  ON room_version_attribution (room_id, version_key DESC);

INSERT OR IGNORE INTO room_ratings (
  room_id,
  lineage_key,
  version_key,
  user_id,
  quality_stars,
  difficulty_choice,
  auto_difficulty_choice,
  trust_weight,
  completed_attempt_id,
  first_rated_at,
  updated_at,
  rewarded_at
)
SELECT
  room_id,
  room_id || ':' || CAST(room_version AS TEXT),
  room_version,
  user_id,
  NULL,
  difficulty,
  difficulty,
  1,
  NULL,
  created_at,
  updated_at,
  created_at
FROM room_difficulty_votes;
