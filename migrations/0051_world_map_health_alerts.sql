CREATE TABLE IF NOT EXISTS world_map_health_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'unhealthy')),
  incident_id TEXT,
  last_checked_at TEXT NOT NULL,
  last_check_id TEXT,
  last_alert_created_at TEXT,
  last_event_id TEXT,
  snapshot_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_map_health_alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('outage', 'reminder', 'recovery', 'test')),
  incident_id TEXT,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  provider_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS world_map_health_alerts_pending
  ON world_map_health_alerts(sent_at, created_at);
