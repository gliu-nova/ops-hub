CREATE TABLE IF NOT EXISTS service_heartbeats (
  service_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  summary TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  links TEXT NOT NULL DEFAULT '{}'
);