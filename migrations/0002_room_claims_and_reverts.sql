ALTER TABLE rooms ADD COLUMN claimer_user_id TEXT;
ALTER TABLE rooms ADD COLUMN claimer_display_name TEXT;
ALTER TABLE rooms ADD COLUMN claimed_at TEXT;
ALTER TABLE rooms ADD COLUMN last_published_by_user_id TEXT;
ALTER TABLE rooms ADD COLUMN last_published_by_display_name TEXT;
ALTER TABLE rooms ADD COLUMN minted_chain_id INTEGER;
ALTER TABLE rooms ADD COLUMN minted_contract_address TEXT;
ALTER TABLE rooms ADD COLUMN minted_token_id TEXT;

ALTER TABLE room_versions ADD COLUMN published_by_user_id TEXT;
ALTER TABLE room_versions ADD COLUMN published_by_display_name TEXT;
ALTER TABLE room_versions ADD COLUMN reverted_from_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_rooms_claimer_user_id ON rooms (claimer_user_id);
