CREATE TABLE bug_reports (
  id TEXT PRIMARY KEY,
  identity_hash TEXT NOT NULL,
  network_hash TEXT NOT NULL,
  submission_hash TEXT NOT NULL,
  user_id TEXT,
  notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  build TEXT NOT NULL,
  context_json TEXT NOT NULL,
  device_json TEXT NOT NULL,
  errors_json TEXT NOT NULL,
  evidence_reason TEXT NOT NULL,
  frames INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  has_screenshot INTEGER NOT NULL,
  evidence_expires_at TEXT
);
CREATE INDEX bug_reports_created ON bug_reports(created_at);
CREATE INDEX bug_reports_identity ON bug_reports(identity_hash, created_at);
CREATE INDEX bug_reports_network ON bug_reports(network_hash, created_at);
CREATE INDEX bug_reports_expiry ON bug_reports(expires_at);
CREATE TABLE bug_report_evidence (
  report_id TEXT PRIMARY KEY REFERENCES bug_reports(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX bug_report_evidence_expiry ON bug_report_evidence(expires_at);
