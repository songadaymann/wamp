-- Builders hear when someone else publishes over a room they claimed (F182).
-- SQLite cannot widen a CHECK constraint in place, so the activity table is rebuilt.
-- Triggers that write to it are dropped first and recreated unchanged afterwards.
PRAGMA defer_foreign_keys = true;

DROP TRIGGER builder_activity_bxp;
DROP TRIGGER builder_activity_top1;
DROP TRIGGER builder_activity_comment_insert;
DROP TRIGGER builder_activity_comment_update;
DROP TRIGGER builder_activity_guest;
DROP TRIGGER builder_activity_guest_claim;

CREATE TABLE builder_activity_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('completion', 'rating', 'comment', 'top1', 'dethroned', 'edited')),
  content_type TEXT NOT NULL CHECK (content_type IN ('room', 'course', 'expanded_room')),
  content_id TEXT NOT NULL,
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  quality_stars INTEGER CHECK (quality_stars BETWEEN 1 AND 5),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('bxp', 'pxp', 'comment', 'guest', 'edit')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO builder_activity_next (id, dedupe_key, recipient_user_id, actor_user_id, kind, content_type,
  content_id, content_version, quality_stars, source_kind, source_id, created_at)
SELECT id, dedupe_key, recipient_user_id, actor_user_id, kind, content_type,
  content_id, content_version, quality_stars, source_kind, source_id, created_at FROM builder_activity;
-- Keep the id sequence where it was: inbox read markers and email watermarks compare ids, so a
-- deleted newest row must not have its id handed out again. A placeholder row at the old high
-- point carries the sequence over and is removed straight away.
INSERT INTO builder_activity_next (id, dedupe_key, recipient_user_id, actor_user_id, kind, content_type,
  content_id, content_version, source_kind, source_id, created_at)
SELECT s.seq, 'migration-0069-sequence', (SELECT id FROM users ORDER BY id LIMIT 1), 'migration', 'comment', 'room',
  'migration', 1, 'comment', 'migration', '1970-01-01T00:00:00.000Z'
FROM sqlite_sequence s
WHERE s.name = 'builder_activity' AND s.seq > COALESCE((SELECT MAX(id) FROM builder_activity), 0)
  AND EXISTS (SELECT 1 FROM users);
DELETE FROM builder_activity_next WHERE dedupe_key = 'migration-0069-sequence';
DROP TABLE builder_activity;
ALTER TABLE builder_activity_next RENAME TO builder_activity;
CREATE INDEX idx_builder_activity_inbox ON builder_activity(recipient_user_id, id DESC);
CREATE INDEX idx_builder_activity_email ON builder_activity(recipient_user_id, kind, created_at, id);
CREATE INDEX idx_builder_activity_guest_actor
  ON builder_activity(actor_user_id, id DESC) WHERE source_kind = 'guest';

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

CREATE TRIGGER builder_activity_guest AFTER UPDATE OF result, verification_status ON guest_run_attempts BEGIN
  INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
    content_type, content_id, content_version, source_kind, source_id, created_at)
  SELECT 'guest:' || builder_user_id || ':' || content_type || ':' || content_id || ':' || content_version || ':' || guest_user_id,
    builder_user_id, guest_user_id, 'completion', content_type, content_id, content_version,
    'guest', attempt_id, finished_at FROM builder_guest_activity_facts WHERE attempt_id = NEW.attempt_id;
END;

CREATE TRIGGER builder_activity_guest_claim AFTER UPDATE OF claimed_user_id ON guest_run_attempts
WHEN NEW.claimed_user_id IS NOT NULL BEGIN
  DELETE FROM builder_activity WHERE source_kind = 'guest' AND actor_user_id = NEW.guest_user_id
    AND recipient_user_id = NEW.claimed_user_id AND content_type = NEW.progress_source_type
    AND content_id = NEW.progress_source_id AND content_version = NEW.content_version;
END;

-- One notice per editor, room and UTC day. Minted rooms only accept their owner, so the
-- original claimer of a sold room is not told about the new owner's changes. Restores (including
-- moderator restores) and numbered-World rooms, whose reviewers publish approved drafts, are
-- not edits by another builder.
CREATE TRIGGER builder_activity_room_edit AFTER INSERT ON room_versions
WHEN NEW.published_by_user_id IS NOT NULL AND NEW.reverted_from_version IS NULL BEGIN
  INSERT OR IGNORE INTO builder_activity (dedupe_key, recipient_user_id, actor_user_id, kind,
    content_type, content_id, content_version, source_kind, source_id, created_at)
  SELECT 'edit:' || NEW.room_id || ':' || NEW.published_by_user_id || ':' || substr(NEW.created_at, 1, 10),
    r.claimer_user_id, NEW.published_by_user_id, 'edited', 'room', NEW.room_id, NEW.version,
    'edit', NEW.room_id || ':' || NEW.version, NEW.created_at
  FROM rooms r
  WHERE r.id = NEW.room_id AND r.claimer_user_id IS NOT NULL AND r.claimer_user_id <> NEW.published_by_user_id
    AND r.minted_token_id IS NULL AND r.minted_chain_id IS NULL AND r.minted_contract_address IS NULL
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = r.claimer_user_id)
    AND NOT EXISTS (SELECT 1 FROM world_room_claims c WHERE c.room_id = NEW.room_id AND c.world_id <> 'wamp-prime')
    AND EXISTS (SELECT 1 FROM room_versions prior WHERE prior.room_id = NEW.room_id AND prior.version < NEW.version);
END;
