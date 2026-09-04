CREATE TABLE IF NOT EXISTS world_entitlements (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  owner_email TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('complimentary', 'payment_provider')),
  provider TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'frozen')),
  claim_limit_ceiling INTEGER NOT NULL CHECK (claim_limit_ceiling > 0),
  publish_limit_ceiling INTEGER NOT NULL CHECK (publish_limit_ceiling > 0),
  billing_interval TEXT CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year')),
  current_period_end TEXT,
  external_customer_ref TEXT,
  external_subscription_ref TEXT,
  grant_idempotency_key TEXT UNIQUE,
  seed_draft_json TEXT,
  seed_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_world_entitlements_owner_user
  ON world_entitlements (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_entitlements_owner_email
  ON world_entitlements (owner_email, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_world_entitlements_external_subscription
  ON world_entitlements (provider, external_subscription_ref)
  WHERE external_subscription_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE CHECK (number >= 0),
  origin_x INTEGER NOT NULL,
  origin_y INTEGER NOT NULL,
  owner_user_id TEXT,
  entitlement_id TEXT UNIQUE,
  approved_name TEXT,
  build_policy TEXT NOT NULL CHECK (build_policy IN ('request_to_join', 'invite_only')),
  publish_policy TEXT NOT NULL CHECK (publish_policy IN ('members_publish', 'approval_required')),
  claim_limit_per_day INTEGER NOT NULL CHECK (claim_limit_per_day > 0),
  publish_limit_per_day INTEGER NOT NULL CHECK (publish_limit_per_day > 0),
  activated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (number = 0 OR (owner_user_id IS NOT NULL AND entitlement_id IS NOT NULL)),
  UNIQUE (origin_x, origin_y),
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  FOREIGN KEY (entitlement_id) REFERENCES world_entitlements (id) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO worlds (
  id, number, origin_x, origin_y, owner_user_id, entitlement_id, approved_name,
  build_policy, publish_policy, claim_limit_per_day, publish_limit_per_day,
  activated_at, created_at, updated_at
) VALUES (
  'wamp-prime', 0, 0, 0, NULL, NULL, 'Prime',
  'request_to_join', 'members_publish', 1, 1,
  '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'
);

CREATE TABLE IF NOT EXISTS world_memberships (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  user_id TEXT,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'builder')),
  status TEXT NOT NULL CHECK (status IN ('invited', 'requested', 'active', 'removed', 'blocked')),
  invited_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (world_id, email),
  FOREIGN KEY (world_id) REFERENCES worlds (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (invited_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_world_memberships_user
  ON world_memberships (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_memberships_world_status
  ON world_memberships (world_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS world_room_claims (
  room_id TEXT PRIMARY KEY,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  world_id TEXT NOT NULL,
  first_builder_user_id TEXT,
  claimed_at TEXT NOT NULL,
  UNIQUE (x, y),
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE,
  FOREIGN KEY (world_id) REFERENCES worlds (id) ON DELETE RESTRICT,
  FOREIGN KEY (first_builder_user_id) REFERENCES users (id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO world_room_claims (room_id, x, y, world_id, first_builder_user_id, claimed_at)
SELECT id, x, y, 'wamp-prime', claimer_user_id, COALESCE(claimed_at, '1970-01-01T00:00:00.000Z')
FROM rooms
WHERE claimer_user_id IS NOT NULL OR claimed_at IS NOT NULL OR published_json IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_world_room_claims_world
  ON world_room_claims (world_id, claimed_at DESC);

CREATE TABLE IF NOT EXISTS world_publication_requests (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  submitted_by_user_id TEXT NOT NULL,
  submitted_draft_updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'stale')),
  rejection_reason TEXT,
  resolved_by_user_id TEXT,
  submitted_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (world_id) REFERENCES worlds (id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE,
  FOREIGN KEY (submitted_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  FOREIGN KEY (resolved_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_publication_requests_pending_room
  ON world_publication_requests (room_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_world_publication_requests_world_status
  ON world_publication_requests (world_id, status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS world_name_requests (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  proposed_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by_user_id TEXT,
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (world_id) REFERENCES worlds (id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  FOREIGN KEY (resolved_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_name_requests_pending_world
  ON world_name_requests (world_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_world_name_requests_status
  ON world_name_requests (status, requested_at ASC);

CREATE TABLE IF NOT EXISTS world_daily_usage (
  world_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  claim_count INTEGER NOT NULL DEFAULT 0,
  publish_count INTEGER NOT NULL DEFAULT 0,
  claim_limit INTEGER NOT NULL,
  publish_limit INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (world_id, user_id, utc_day),
  CHECK (claim_count >= 0 AND claim_count <= claim_limit),
  CHECK (publish_count >= 0 AND publish_count <= publish_limit),
  FOREIGN KEY (world_id) REFERENCES worlds (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_ownership_events (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('activated', 'future_transfer')),
  source TEXT NOT NULL,
  external_ref TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (world_id) REFERENCES worlds (id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_world_ownership_events_world
  ON world_ownership_events (world_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS world_activity_events (
  id TEXT PRIMARY KEY,
  world_id TEXT,
  entitlement_id TEXT,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  subject_id TEXT,
  metadata_json TEXT,
  idempotency_key TEXT UNIQUE,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (world_id) REFERENCES worlds (id) ON DELETE CASCADE,
  FOREIGN KEY (entitlement_id) REFERENCES world_entitlements (id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_world_activity_events_world
  ON world_activity_events (world_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_activity_events_type
  ON world_activity_events (event_type, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS prevent_world_identity_update
BEFORE UPDATE OF number, origin_x, origin_y ON worlds
WHEN OLD.number != NEW.number OR OLD.origin_x != NEW.origin_x OR OLD.origin_y != NEW.origin_y
BEGIN
  SELECT RAISE(ABORT, 'World number and origin are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_world_delete
BEFORE DELETE ON worlds
BEGIN
  SELECT RAISE(ABORT, 'World records are permanent');
END;

CREATE TRIGGER IF NOT EXISTS prevent_world_room_provenance_update
BEFORE UPDATE OF room_id, x, y, world_id, first_builder_user_id, claimed_at ON world_room_claims
BEGIN
  SELECT RAISE(ABORT, 'World room provenance is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_world_room_provenance_delete
BEFORE DELETE ON world_room_claims
BEGIN
  SELECT RAISE(ABORT, 'World room provenance is permanent');
END;

CREATE TRIGGER IF NOT EXISTS prevent_world_ownership_event_update
BEFORE UPDATE ON world_ownership_events
BEGIN
  SELECT RAISE(ABORT, 'World ownership events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS prevent_world_ownership_event_delete
BEFORE DELETE ON world_ownership_events
BEGIN
  SELECT RAISE(ABORT, 'World ownership events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS guard_world_publication_resolution
BEFORE UPDATE OF status ON world_publication_requests
WHEN NEW.status IN ('approved', 'rejected') AND OLD.status != 'pending'
BEGIN
  SELECT RAISE(ABORT, 'World publication request is no longer pending');
END;

CREATE TRIGGER IF NOT EXISTS guard_world_publication_draft_timestamp
BEFORE UPDATE OF status ON world_publication_requests
WHEN NEW.status = 'approved' AND OLD.submitted_draft_updated_at IS NOT (
  SELECT json_extract(draft_json, '$.updatedAt') FROM rooms WHERE id = OLD.room_id
)
BEGIN
  SELECT RAISE(ABORT, 'World publication draft is stale');
END;
