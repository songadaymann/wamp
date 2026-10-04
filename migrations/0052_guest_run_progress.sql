-- Guest attempts never enter ranked tables. Only verified clears can be claimed.
CREATE TABLE guest_run_attempts (
  attempt_id TEXT PRIMARY KEY,
  guest_user_id TEXT NOT NULL,
  recovery_token_hash TEXT NOT NULL,
  client_run_id TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('room', 'course', 'expanded_room')),
  content_id TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  content_title TEXT,
  progress_source_type TEXT NOT NULL CHECK (progress_source_type IN ('room', 'course')),
  progress_source_id TEXT NOT NULL,
  snapshot_json TEXT,
  verification_nonce TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'active' CHECK (result IN ('active', 'completed', 'failed', 'abandoned')),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'passed', 'failed', 'timeout')),
  verification_reason TEXT,
  finish_request_hash TEXT,
  finished_at TEXT,
  metrics_json TEXT,
  claimed_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  claim_id TEXT,
  claimed_at TEXT
);
CREATE UNIQUE INDEX idx_guest_runs_client ON guest_run_attempts(guest_user_id, recovery_token_hash, client_run_id);
CREATE INDEX idx_guest_runs_recovery ON guest_run_attempts(guest_user_id, recovery_token_hash, claimed_user_id, finished_at);
CREATE INDEX idx_guest_runs_expiry ON guest_run_attempts(expires_at) WHERE claim_id IS NULL;
CREATE INDEX idx_guest_runs_account ON guest_run_attempts(claimed_user_id, finished_at) WHERE claimed_user_id IS NOT NULL;
CREATE INDEX idx_guest_runs_claim ON guest_run_attempts(claim_id);

CREATE TABLE guest_run_snapshot_rooms (
  attempt_id TEXT NOT NULL REFERENCES guest_run_attempts(attempt_id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (attempt_id, room_id)
);

CREATE TABLE guest_run_claims (
  id TEXT PRIMARY KEY,
  guest_user_id TEXT NOT NULL,
  recovery_token_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clear_count INTEGER NOT NULL DEFAULT 0,
  pxp_awarded INTEGER NOT NULL DEFAULT 0,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created_at TEXT NOT NULL
);
