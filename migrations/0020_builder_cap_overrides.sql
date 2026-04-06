ALTER TABLE user_progress
  ADD COLUMN builder_claim_limit_override INTEGER;

ALTER TABLE user_progress
  ADD COLUMN builder_publish_limit_override INTEGER;

ALTER TABLE user_progress
  ADD COLUMN builder_object_limit_override INTEGER;

ALTER TABLE user_progress
  ADD COLUMN builder_collectible_limit_override INTEGER;

ALTER TABLE user_progress
  ADD COLUMN builder_cap_override_reason TEXT;

ALTER TABLE user_progress
  ADD COLUMN builder_cap_override_updated_at TEXT;

ALTER TABLE user_progress
  ADD COLUMN builder_cap_override_updated_by TEXT;
