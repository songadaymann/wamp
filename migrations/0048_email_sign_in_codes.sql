ALTER TABLE magic_link_tokens ADD COLUMN code_hash TEXT;
ALTER TABLE magic_link_tokens ADD COLUMN code_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email_created
  ON magic_link_tokens (email, created_at DESC);
