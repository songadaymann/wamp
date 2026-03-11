CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id
  ON api_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash
  ON api_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_api_tokens_revoked_at
  ON api_tokens (revoked_at);
