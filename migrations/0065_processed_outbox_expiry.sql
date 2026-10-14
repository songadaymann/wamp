-- Hourly cleanup only scans completed renderer dispatches older than seven days.
CREATE INDEX IF NOT EXISTS idx_world_render_tile_outbox_processed_expiry
  ON world_render_tile_outbox(dispatched_at, id) WHERE state = 'dispatched';
