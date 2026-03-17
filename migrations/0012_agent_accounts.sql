CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL UNIQUE,
  description TEXT,
  avatar_url TEXT,
  avatar_seed TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agents_owner_user_id
  ON agents (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  created_by_user_id TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_agent_id
  ON agent_tokens (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_token_hash
  ON agent_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_revoked_at
  ON agent_tokens (revoked_at);

ALTER TABLE rooms ADD COLUMN claimer_principal_type TEXT;
ALTER TABLE rooms ADD COLUMN claimer_agent_id TEXT;
ALTER TABLE rooms ADD COLUMN last_published_by_principal_type TEXT;
ALTER TABLE rooms ADD COLUMN last_published_by_agent_id TEXT;

ALTER TABLE room_versions ADD COLUMN published_by_principal_type TEXT;
ALTER TABLE room_versions ADD COLUMN published_by_agent_id TEXT;

UPDATE rooms
SET
  claimer_principal_type = CASE
    WHEN claimer_user_id IS NOT NULL THEN 'user'
    ELSE NULL
  END,
  last_published_by_principal_type = CASE
    WHEN last_published_by_user_id IS NOT NULL THEN 'user'
    ELSE NULL
  END
WHERE claimer_principal_type IS NULL
   OR last_published_by_principal_type IS NULL;

UPDATE room_versions
SET published_by_principal_type = CASE
  WHEN published_by_user_id IS NOT NULL THEN 'user'
  ELSE NULL
END
WHERE published_by_principal_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_claimer_agent_id
  ON rooms (claimer_agent_id);

CREATE INDEX IF NOT EXISTS idx_room_versions_published_by_agent_id
  ON room_versions (published_by_agent_id, created_at DESC);
