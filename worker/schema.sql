CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ward TEXT NOT NULL,
  town TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('siren','smoke','fire')),
  at TEXT NOT NULL,
  who TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_at ON reports(at);
CREATE INDEX IF NOT EXISTS idx_reports_who ON reports(who, ward, at);
