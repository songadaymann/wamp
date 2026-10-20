-- One active capture, nine manual attempts and one daily attempt per Eastern day.
-- Failed attempts remain spent; rows expire through bounded capture-time cleanup.
CREATE TABLE map_screenshot_capture_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  daily_zoom REAL,
  daily_zoom_date TEXT
);
INSERT INTO map_screenshot_capture_lease (id) VALUES (1);
CREATE TABLE map_screenshot_capture_attempts (
  day TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 9),
  token TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (day, slot)
);
CREATE INDEX map_screenshot_capture_attempts_expiry ON map_screenshot_capture_attempts (started_at);
