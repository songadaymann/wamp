-- Additive cache of the significant-change bucket used by rating writes.
-- Filled from immutable version history by index refresh/repair. NULL remains
-- readable through the same history resolver during rolling upgrades.
ALTER TABLE room_versions ADD COLUMN rating_version_key INTEGER;
ALTER TABLE expanded_room_versions ADD COLUMN rating_version_key INTEGER;
