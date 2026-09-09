ALTER TABLE guest_replay_sessions ADD COLUMN visit_session_id TEXT;
CREATE INDEX guest_replay_visit_link ON guest_replay_sessions(visit_session_id, started_at);
