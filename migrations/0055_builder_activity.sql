-- Private inbox, independent opt-in preferences, and durable email delivery receipts.
CREATE TABLE builder_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('completion', 'rating', 'comment', 'top1', 'dethroned')),
  content_type TEXT NOT NULL CHECK (content_type IN ('room', 'course', 'expanded_room')),
  content_id TEXT NOT NULL,
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  quality_stars INTEGER CHECK (quality_stars BETWEEN 1 AND 5),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('bxp', 'pxp', 'comment', 'guest')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_builder_activity_inbox ON builder_activity(recipient_user_id, id DESC);
CREATE INDEX idx_builder_activity_email ON builder_activity(recipient_user_id, kind, created_at, id);
CREATE TABLE builder_activity_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seen_id INTEGER NOT NULL DEFAULT 0,
  weekly_digest INTEGER NOT NULL DEFAULT 0 CHECK (weekly_digest IN (0, 1)),
  dethrone_alerts INTEGER NOT NULL DEFAULT 0 CHECK (dethrone_alerts IN (0, 1)),
  digest_enabled_at TEXT,
  dethrone_enabled_at TEXT,
  unsubscribe_secret TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE builder_activity_emails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('digest', 'dethroned')),
  period_key TEXT NOT NULL,
  message_json TEXT NOT NULL,
  latest_activity_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sent_at TEXT,
  provider_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until TEXT,
  last_error TEXT,
  cancelled_at TEXT,
  UNIQUE (user_id, kind, period_key)
);
CREATE INDEX idx_builder_activity_emails_pending ON builder_activity_emails(sent_at, cancelled_at, created_at);

-- Structured facts come from eligible XP awards, after verification. The legacy
-- fallback supports old room/UUID course keys without guessing ambiguous IDs.
CREATE VIEW builder_bxp_activity_facts AS
WITH parsed AS (
  SELECT b.*,
    substr(source_id, 1, instr(source_id, ':') - 1) AS legacy_content_id,
    substr(source_id, instr(source_id, ':') + 1) AS legacy_tail,
    CASE WHEN json_valid(breakdown_json) THEN breakdown_json ELSE '{}' END AS facts
  FROM bxp_events b WHERE event_type IN ('unique_completion_room', 'unique_rating_room',
    'unique_completion_course', 'unique_rating_course')
), facts AS (
  SELECT id, user_id, created_at,
    CASE WHEN event_type LIKE 'unique_completion_%' THEN 'completion' ELSE 'rating' END AS kind,
    COALESCE(json_extract(facts, '$.activity.contentType'),
      CASE WHEN event_type LIKE '%_room' THEN 'room' ELSE 'course' END) AS content_type,
    COALESCE(json_extract(facts, '$.activity.contentId'), legacy_content_id) AS content_id,
    COALESCE(json_extract(facts, '$.activity.version'), CAST(substr(legacy_tail, 1, instr(legacy_tail, ':') - 1) AS INTEGER)) AS content_version,
    COALESCE(json_extract(facts, '$.activity.actorUserId'), substr(legacy_tail, instr(legacy_tail, ':') + 1)) AS actor_user_id,
    json_extract(facts, '$.activity.qualityStars') AS quality_stars,
    source_id
  FROM parsed
)
SELECT * FROM facts WHERE content_version > 0 AND content_id <> '' AND actor_user_id <> user_id
  AND EXISTS (SELECT 1 FROM users WHERE users.id = facts.actor_user_id)
  AND (content_type = 'room' AND EXISTS (SELECT 1 FROM rooms WHERE rooms.id = facts.content_id)
    OR content_type = 'course' AND EXISTS (SELECT 1 FROM courses WHERE courses.id = facts.content_id));
CREATE TRIGGER builder_activity_bxp AFTER INSERT ON bxp_events BEGIN
  INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
    content_type, content_id, content_version, quality_stars, source_kind, source_id, created_at)
  SELECT 'bxp:' || id, user_id, actor_user_id, kind, content_type, content_id, content_version,
    quality_stars, 'bxp', id, created_at FROM builder_bxp_activity_facts WHERE id = NEW.id;
END;


CREATE TRIGGER builder_activity_top1 AFTER INSERT ON pxp_events
WHEN NEW.event_type = 'top1_take' AND json_valid(NEW.breakdown_json) BEGIN
  INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
    content_type, content_id, content_version, source_kind, source_id, created_at)
  SELECT 'pxp:top1:' || NEW.id, json_extract(NEW.breakdown_json, '$.activity.builderUserId'), NEW.user_id,
    'top1', json_extract(NEW.breakdown_json, '$.activity.contentType'),
    json_extract(NEW.breakdown_json, '$.activity.contentId'), json_extract(NEW.breakdown_json, '$.activity.version'),
    'pxp', NEW.id, NEW.created_at
  WHERE json_extract(NEW.breakdown_json, '$.activity.builderUserId') IS NOT NULL
    AND json_extract(NEW.breakdown_json, '$.activity.builderUserId') <> NEW.user_id
    AND json_extract(NEW.breakdown_json, '$.activity.builderUserId') IS NOT json_extract(NEW.breakdown_json, '$.activity.dethronedUserId')
;
  INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
    content_type, content_id, content_version, source_kind, source_id, created_at)
  SELECT 'pxp:dethroned:' || NEW.id, json_extract(NEW.breakdown_json, '$.activity.dethronedUserId'), NEW.user_id,
    'dethroned', json_extract(NEW.breakdown_json, '$.activity.contentType'),
    json_extract(NEW.breakdown_json, '$.activity.contentId'), json_extract(NEW.breakdown_json, '$.activity.version'),
    'pxp', NEW.id, NEW.created_at
  WHERE json_extract(NEW.breakdown_json, '$.activity.dethronedUserId') IS NOT NULL
    AND json_extract(NEW.breakdown_json, '$.activity.dethronedUserId') <> NEW.user_id
;
END;

CREATE TRIGGER builder_activity_comment_insert AFTER INSERT ON room_comments BEGIN
  INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
    content_type, content_id, content_version, source_kind, source_id, created_at)
  SELECT 'comment:' || id, builder_user_id, author_user_id, 'comment', 'room', room_id, room_version,
    'comment', id, COALESCE(reviewed_at, created_at) FROM room_comments
  WHERE status = 'approved' AND builder_user_id IS NOT NULL AND builder_user_id <> author_user_id AND id = NEW.id;
END;
CREATE TRIGGER builder_activity_comment_update AFTER UPDATE OF status ON room_comments BEGIN
  INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
    content_type, content_id, content_version, source_kind, source_id, created_at)
  SELECT 'comment:' || id, builder_user_id, author_user_id, 'comment', 'room', room_id, room_version,
    'comment', id, COALESCE(reviewed_at, created_at) FROM room_comments
  WHERE status = 'approved' AND builder_user_id IS NOT NULL AND builder_user_id <> author_user_id AND id = NEW.id;
END;


-- A verified guest is shown as Guest; recovery tokens and IPs never enter this projection.
CREATE VIEW builder_guest_activity_facts AS
SELECT g.attempt_id, g.guest_user_id, g.progress_source_type AS content_type, g.progress_source_id AS content_id, g.content_version, g.finished_at,
  COALESCE(rv.published_by_user_id, r.claimer_user_id, c.owner_user_id, e.owner_user_id) AS builder_user_id
FROM guest_run_attempts g
LEFT JOIN rooms r ON g.progress_source_type = 'room' AND r.id = g.progress_source_id
LEFT JOIN room_versions rv ON rv.room_id = r.id AND rv.version = g.content_version
LEFT JOIN courses c ON g.progress_source_type = 'course' AND c.id = g.progress_source_id
LEFT JOIN expanded_rooms e ON g.progress_source_type = 'course' AND e.id = g.progress_source_id
WHERE g.result = 'completed' AND g.verification_status = 'passed' AND g.finished_at IS NOT NULL
  AND COALESCE(rv.published_by_user_id, r.claimer_user_id, c.owner_user_id, e.owner_user_id) IS NOT NULL
  AND COALESCE(g.claimed_user_id, '') <> COALESCE(rv.published_by_user_id, r.claimer_user_id, c.owner_user_id, e.owner_user_id);
CREATE TRIGGER builder_activity_guest AFTER UPDATE OF result, verification_status ON guest_run_attempts BEGIN
  INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
    content_type, content_id, content_version, source_kind, source_id, created_at)
  SELECT 'guest:' || builder_user_id || ':' || content_type || ':' || content_id || ':' || content_version || ':' || guest_user_id,
    builder_user_id, guest_user_id, 'completion', content_type, content_id, content_version,
    'guest', attempt_id, finished_at FROM builder_guest_activity_facts WHERE attempt_id = NEW.attempt_id;
END;


-- A builder claiming their own earlier guest clear must not notify themselves.
CREATE TRIGGER builder_activity_guest_claim AFTER UPDATE OF claimed_user_id ON guest_run_attempts
WHEN NEW.claimed_user_id IS NOT NULL BEGIN
  DELETE FROM builder_activity WHERE source_kind = 'guest' AND actor_user_id = NEW.guest_user_id
    AND recipient_user_id = NEW.claimed_user_id AND content_type = NEW.progress_source_type
    AND content_id = NEW.progress_source_id AND content_version = NEW.content_version;
END;

-- One chronological backfill for all sources. Structured details are preferred;
-- historical stars are left unknown rather than inventing the first vote’s value.
INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
  content_type, content_id, content_version, quality_stars, source_kind, source_id, created_at)
SELECT * FROM (
SELECT 'bxp:' || id, user_id, actor_user_id, kind, content_type, content_id, content_version,
  quality_stars, 'bxp', id, created_at FROM builder_bxp_activity_facts
UNION ALL
SELECT 'comment:' || id, builder_user_id, author_user_id, 'comment', 'room', room_id, room_version,
    NULL, 'comment', id, COALESCE(reviewed_at, created_at) FROM room_comments
  WHERE status = 'approved' AND builder_user_id IS NOT NULL AND builder_user_id <> author_user_id
UNION ALL
SELECT 'guest:' || builder_user_id || ':' || content_type || ':' || content_id || ':' || content_version || ':' || guest_user_id,
    builder_user_id, guest_user_id, 'completion', content_type, content_id, content_version,
    NULL, 'guest', attempt_id, finished_at FROM builder_guest_activity_facts
) ORDER BY 11, 1;
