ALTER TABLE rooms ADD COLUMN minted_owner_wallet_address TEXT;
ALTER TABLE rooms ADD COLUMN minted_owner_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_minted_owner_wallet_address
  ON rooms (minted_owner_wallet_address);
