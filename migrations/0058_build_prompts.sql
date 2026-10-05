-- Prompts share the main published-content and account identities. No first theme is seeded.
CREATE TABLE build_prompts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  constraint_text TEXT NOT NULL,
  starts_at TEXT NOT NULL UNIQUE,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  settled_at TEXT,
  CHECK (starts_at < ends_at)
);
CREATE INDEX idx_build_prompts_end ON build_prompts(settled_at, ends_at);
CREATE TABLE build_prompt_entries (
  prompt_slug TEXT NOT NULL REFERENCES build_prompts(slug) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('room','expanded_room')),
  content_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL CHECK (room_version > 0),
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  title TEXT NOT NULL,
  builder_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  builder_display_name TEXT NOT NULL,
  cell_count INTEGER NOT NULL,
  legacy_course_id TEXT,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (prompt_slug, target_key),
  UNIQUE (prompt_slug, builder_user_id)
);
CREATE INDEX idx_build_prompt_entries_page ON build_prompt_entries(prompt_slug, submitted_at, target_key);
-- Freeze votes when they are submitted through the existing verified rating flow.
-- Ratings edited after a prompt closes cannot change its results.
CREATE TABLE build_prompt_votes (
  prompt_slug TEXT NOT NULL,
  target_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quality_stars INTEGER NOT NULL CHECK (quality_stars BETWEEN 1 AND 5),
  trust_weight REAL NOT NULL CHECK (trust_weight > 0),
  completed_attempt_id TEXT NOT NULL,
  rated_at TEXT NOT NULL,
  PRIMARY KEY (prompt_slug, target_key, user_id),
  FOREIGN KEY (prompt_slug, target_key) REFERENCES build_prompt_entries(prompt_slug, target_key) ON DELETE CASCADE
);
CREATE TABLE build_prompt_winners (
  prompt_slug TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  target_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  vote_count INTEGER NOT NULL,
  adjusted_average REAL NOT NULL,
  awarded_at TEXT NOT NULL,
  PRIMARY KEY (prompt_slug, rank),
  UNIQUE (prompt_slug, target_key),
  FOREIGN KEY (prompt_slug, target_key) REFERENCES build_prompt_entries(prompt_slug, target_key) ON DELETE CASCADE
);

CREATE TRIGGER build_prompt_room_ratings_insert AFTER INSERT ON room_ratings BEGIN
  DELETE FROM build_prompt_votes WHERE user_id=NEW.user_id AND EXISTS(SELECT 1 FROM build_prompt_entries entry JOIN build_prompts prompt ON prompt.slug=entry.prompt_slug
    WHERE entry.prompt_slug=build_prompt_votes.prompt_slug AND entry.target_key=build_prompt_votes.target_key
      AND entry.content_type='room' AND entry.content_id=NEW.room_id AND NEW.updated_at>=prompt.starts_at AND NEW.updated_at<prompt.ends_at AND prompt.settled_at IS NULL);
  INSERT OR REPLACE INTO build_prompt_votes(prompt_slug,target_key,version,user_id,quality_stars,trust_weight,completed_attempt_id,rated_at)
    SELECT entry.prompt_slug, entry.target_key, entry.version, NEW.user_id, NEW.quality_stars,
    NEW.trust_weight, NEW.completed_attempt_id, NEW.updated_at
     FROM build_prompt_entries entry WHERE entry.content_type = 'room' AND entry.content_id = NEW.room_id
    AND EXISTS (SELECT 1 FROM build_prompts prompt WHERE prompt.slug = entry.prompt_slug AND
    NEW.quality_stars BETWEEN 1 AND 5 AND NEW.trust_weight > 0
    AND NEW.user_id <> entry.builder_user_id AND NEW.completed_attempt_id IS NOT NULL
    AND NEW.updated_at >= prompt.starts_at AND NEW.updated_at < prompt.ends_at
    AND prompt.settled_at IS NULL
    AND EXISTS (SELECT 1 FROM room_runs run WHERE run.attempt_id = NEW.completed_attempt_id
    AND run.room_id = entry.content_id AND run.room_version = entry.version AND run.user_id = NEW.user_id
    AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
    AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at) );
END;

CREATE TRIGGER build_prompt_room_ratings_update AFTER UPDATE ON room_ratings BEGIN
  DELETE FROM build_prompt_votes WHERE user_id=NEW.user_id AND EXISTS(SELECT 1 FROM build_prompt_entries entry JOIN build_prompts prompt ON prompt.slug=entry.prompt_slug
    WHERE entry.prompt_slug=build_prompt_votes.prompt_slug AND entry.target_key=build_prompt_votes.target_key
      AND entry.content_type='room' AND entry.content_id=NEW.room_id AND NEW.updated_at>=prompt.starts_at AND NEW.updated_at<prompt.ends_at AND prompt.settled_at IS NULL);
  INSERT OR REPLACE INTO build_prompt_votes(prompt_slug,target_key,version,user_id,quality_stars,trust_weight,completed_attempt_id,rated_at)
    SELECT entry.prompt_slug, entry.target_key, entry.version, NEW.user_id, NEW.quality_stars,
    NEW.trust_weight, NEW.completed_attempt_id, NEW.updated_at
     FROM build_prompt_entries entry WHERE entry.content_type = 'room' AND entry.content_id = NEW.room_id
    AND EXISTS (SELECT 1 FROM build_prompts prompt WHERE prompt.slug = entry.prompt_slug AND
    NEW.quality_stars BETWEEN 1 AND 5 AND NEW.trust_weight > 0
    AND NEW.user_id <> entry.builder_user_id AND NEW.completed_attempt_id IS NOT NULL
    AND NEW.updated_at >= prompt.starts_at AND NEW.updated_at < prompt.ends_at
    AND prompt.settled_at IS NULL
    AND EXISTS (SELECT 1 FROM room_runs run WHERE run.attempt_id = NEW.completed_attempt_id
    AND run.room_id = entry.content_id AND run.room_version = entry.version AND run.user_id = NEW.user_id
    AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
    AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at) );
END;

CREATE TRIGGER build_prompt_expanded_room_ratings_insert AFTER INSERT ON expanded_room_ratings BEGIN
  DELETE FROM build_prompt_votes WHERE user_id=NEW.user_id AND EXISTS(SELECT 1 FROM build_prompt_entries entry JOIN build_prompts prompt ON prompt.slug=entry.prompt_slug
    WHERE entry.prompt_slug=build_prompt_votes.prompt_slug AND entry.target_key=build_prompt_votes.target_key
      AND entry.content_type='expanded_room' AND (entry.content_id=NEW.expanded_room_id OR entry.legacy_course_id=NEW.expanded_room_id) AND NEW.updated_at>=prompt.starts_at AND NEW.updated_at<prompt.ends_at AND prompt.settled_at IS NULL);
  INSERT OR REPLACE INTO build_prompt_votes(prompt_slug,target_key,version,user_id,quality_stars,trust_weight,completed_attempt_id,rated_at)
    SELECT entry.prompt_slug, entry.target_key, entry.version, NEW.user_id, NEW.quality_stars,
    NEW.trust_weight, NEW.completed_attempt_id, NEW.updated_at
     FROM build_prompt_entries entry WHERE entry.content_type = 'expanded_room' AND (NEW.expanded_room_id = entry.content_id OR NEW.expanded_room_id = entry.legacy_course_id)
    AND EXISTS (SELECT 1 FROM build_prompts prompt WHERE prompt.slug = entry.prompt_slug AND
    NEW.quality_stars BETWEEN 1 AND 5 AND NEW.trust_weight > 0
    AND NEW.user_id <> entry.builder_user_id AND NEW.completed_attempt_id IS NOT NULL
    AND NEW.updated_at >= prompt.starts_at AND NEW.updated_at < prompt.ends_at
    AND prompt.settled_at IS NULL
    AND (EXISTS (SELECT 1 FROM expanded_room_runs run WHERE run.attempt_id = NEW.completed_attempt_id
      AND run.expanded_room_id = entry.content_id AND run.expanded_room_version = entry.version AND run.user_id = NEW.user_id
      AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)
    OR EXISTS (SELECT 1 FROM course_runs run WHERE run.attempt_id = NEW.completed_attempt_id
      AND (run.course_id = entry.content_id OR run.course_id = entry.legacy_course_id) AND run.course_version = entry.version
      AND run.user_id = NEW.user_id AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)) );
END;

CREATE TRIGGER build_prompt_expanded_room_ratings_update AFTER UPDATE ON expanded_room_ratings BEGIN
  DELETE FROM build_prompt_votes WHERE user_id=NEW.user_id AND EXISTS(SELECT 1 FROM build_prompt_entries entry JOIN build_prompts prompt ON prompt.slug=entry.prompt_slug
    WHERE entry.prompt_slug=build_prompt_votes.prompt_slug AND entry.target_key=build_prompt_votes.target_key
      AND entry.content_type='expanded_room' AND (entry.content_id=NEW.expanded_room_id OR entry.legacy_course_id=NEW.expanded_room_id) AND NEW.updated_at>=prompt.starts_at AND NEW.updated_at<prompt.ends_at AND prompt.settled_at IS NULL);
  INSERT OR REPLACE INTO build_prompt_votes(prompt_slug,target_key,version,user_id,quality_stars,trust_weight,completed_attempt_id,rated_at)
    SELECT entry.prompt_slug, entry.target_key, entry.version, NEW.user_id, NEW.quality_stars,
    NEW.trust_weight, NEW.completed_attempt_id, NEW.updated_at
     FROM build_prompt_entries entry WHERE entry.content_type = 'expanded_room' AND (NEW.expanded_room_id = entry.content_id OR NEW.expanded_room_id = entry.legacy_course_id)
    AND EXISTS (SELECT 1 FROM build_prompts prompt WHERE prompt.slug = entry.prompt_slug AND
    NEW.quality_stars BETWEEN 1 AND 5 AND NEW.trust_weight > 0
    AND NEW.user_id <> entry.builder_user_id AND NEW.completed_attempt_id IS NOT NULL
    AND NEW.updated_at >= prompt.starts_at AND NEW.updated_at < prompt.ends_at
    AND prompt.settled_at IS NULL
    AND (EXISTS (SELECT 1 FROM expanded_room_runs run WHERE run.attempt_id = NEW.completed_attempt_id
      AND run.expanded_room_id = entry.content_id AND run.expanded_room_version = entry.version AND run.user_id = NEW.user_id
      AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)
    OR EXISTS (SELECT 1 FROM course_runs run WHERE run.attempt_id = NEW.completed_attempt_id
      AND (run.course_id = entry.content_id OR run.course_id = entry.legacy_course_id) AND run.course_version = entry.version
      AND run.user_id = NEW.user_id AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)) );
END;

CREATE TRIGGER build_prompt_course_ratings_insert AFTER INSERT ON course_ratings BEGIN
  DELETE FROM build_prompt_votes WHERE user_id=NEW.user_id AND EXISTS(SELECT 1 FROM build_prompt_entries entry JOIN build_prompts prompt ON prompt.slug=entry.prompt_slug
    WHERE entry.prompt_slug=build_prompt_votes.prompt_slug AND entry.target_key=build_prompt_votes.target_key
      AND entry.content_type='expanded_room' AND (entry.content_id=NEW.course_id OR entry.legacy_course_id=NEW.course_id) AND NEW.updated_at>=prompt.starts_at AND NEW.updated_at<prompt.ends_at AND prompt.settled_at IS NULL);
  INSERT OR REPLACE INTO build_prompt_votes(prompt_slug,target_key,version,user_id,quality_stars,trust_weight,completed_attempt_id,rated_at)
    SELECT entry.prompt_slug, entry.target_key, entry.version, NEW.user_id, NEW.quality_stars,
    NEW.trust_weight, NEW.completed_attempt_id, NEW.updated_at
     FROM build_prompt_entries entry WHERE entry.content_type = 'expanded_room' AND (NEW.course_id = entry.content_id OR NEW.course_id = entry.legacy_course_id)
    AND EXISTS (SELECT 1 FROM build_prompts prompt WHERE prompt.slug = entry.prompt_slug AND
    NEW.quality_stars BETWEEN 1 AND 5 AND NEW.trust_weight > 0
    AND NEW.user_id <> entry.builder_user_id AND NEW.completed_attempt_id IS NOT NULL
    AND NEW.updated_at >= prompt.starts_at AND NEW.updated_at < prompt.ends_at
    AND prompt.settled_at IS NULL
    AND (EXISTS (SELECT 1 FROM expanded_room_runs run WHERE run.attempt_id = NEW.completed_attempt_id
      AND run.expanded_room_id = entry.content_id AND run.expanded_room_version = entry.version AND run.user_id = NEW.user_id
      AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)
    OR EXISTS (SELECT 1 FROM course_runs run WHERE run.attempt_id = NEW.completed_attempt_id
      AND (run.course_id = entry.content_id OR run.course_id = entry.legacy_course_id) AND run.course_version = entry.version
      AND run.user_id = NEW.user_id AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)) );
END;

CREATE TRIGGER build_prompt_course_ratings_update AFTER UPDATE ON course_ratings BEGIN
  DELETE FROM build_prompt_votes WHERE user_id=NEW.user_id AND EXISTS(SELECT 1 FROM build_prompt_entries entry JOIN build_prompts prompt ON prompt.slug=entry.prompt_slug
    WHERE entry.prompt_slug=build_prompt_votes.prompt_slug AND entry.target_key=build_prompt_votes.target_key
      AND entry.content_type='expanded_room' AND (entry.content_id=NEW.course_id OR entry.legacy_course_id=NEW.course_id) AND NEW.updated_at>=prompt.starts_at AND NEW.updated_at<prompt.ends_at AND prompt.settled_at IS NULL);
  INSERT OR REPLACE INTO build_prompt_votes(prompt_slug,target_key,version,user_id,quality_stars,trust_weight,completed_attempt_id,rated_at)
    SELECT entry.prompt_slug, entry.target_key, entry.version, NEW.user_id, NEW.quality_stars,
    NEW.trust_weight, NEW.completed_attempt_id, NEW.updated_at
     FROM build_prompt_entries entry WHERE entry.content_type = 'expanded_room' AND (NEW.course_id = entry.content_id OR NEW.course_id = entry.legacy_course_id)
    AND EXISTS (SELECT 1 FROM build_prompts prompt WHERE prompt.slug = entry.prompt_slug AND
    NEW.quality_stars BETWEEN 1 AND 5 AND NEW.trust_weight > 0
    AND NEW.user_id <> entry.builder_user_id AND NEW.completed_attempt_id IS NOT NULL
    AND NEW.updated_at >= prompt.starts_at AND NEW.updated_at < prompt.ends_at
    AND prompt.settled_at IS NULL
    AND (EXISTS (SELECT 1 FROM expanded_room_runs run WHERE run.attempt_id = NEW.completed_attempt_id
      AND run.expanded_room_id = entry.content_id AND run.expanded_room_version = entry.version AND run.user_id = NEW.user_id
      AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)
    OR EXISTS (SELECT 1 FROM course_runs run WHERE run.attempt_id = NEW.completed_attempt_id
      AND (run.course_id = entry.content_id OR run.course_id = entry.legacy_course_id) AND run.course_version = entry.version
      AND run.user_id = NEW.user_id AND run.result = 'completed' AND COALESCE(run.verification_status, 'not_required') IN ('not_required', 'passed')
      AND run.finished_at >= prompt.starts_at AND run.finished_at < prompt.ends_at)) );
END;
