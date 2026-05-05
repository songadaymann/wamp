ALTER TABLE guest_visits ADD COLUMN last_play_at TEXT;
ALTER TABLE guest_visits ADD COLUMN last_edit_at TEXT;

CREATE INDEX IF NOT EXISTS idx_guest_visits_last_play_at
  ON guest_visits (last_play_at);

CREATE INDEX IF NOT EXISTS idx_guest_visits_last_edit_at
  ON guest_visits (last_edit_at);
