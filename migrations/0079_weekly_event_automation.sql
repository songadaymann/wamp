ALTER TABLE room_rush_weeks ADD COLUMN picked_by TEXT NOT NULL DEFAULT 'admin'
  CHECK (picked_by IN ('admin', 'automatic'));
ALTER TABLE build_prompts ADD COLUMN picked_by TEXT NOT NULL DEFAULT 'admin'
  CHECK (picked_by IN ('admin', 'automatic'));
ALTER TABLE build_prompts ADD COLUMN automatic_prompt_key TEXT;

-- A deliberate admin deletion stays empty instead of being recreated by the next hourly run.
CREATE TABLE weekly_event_suppressions (
  event_kind TEXT NOT NULL CHECK (event_kind IN ('rush', 'prompt')),
  starts_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_kind, starts_at)
);

-- Weekly ranked Rush uses a server-bound movement trace before entering standings.
ALTER TABLE room_rush_run_starts ADD COLUMN verification_nonce TEXT;
ALTER TABLE room_rush_run_starts ADD COLUMN verification_snapshot_hash TEXT;
ALTER TABLE room_rush_runs ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'legacy';
