CREATE TABLE IF NOT EXISTS event_buckets (
  minute_bucket TEXT NOT NULL,
  event_type TEXT NOT NULL,
  browser_family TEXT NOT NULL,
  browser_major TEXT NOT NULL,
  os_family TEXT NOT NULL,
  page_version TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (
    minute_bucket,
    event_type,
    browser_family,
    browser_major,
    os_family,
    page_version
  )
);

CREATE INDEX IF NOT EXISTS idx_event_buckets_type_time
  ON event_buckets (event_type, minute_bucket);

CREATE TABLE IF NOT EXISTS rate_limits (
  hour_bucket TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (hour_bucket, client_hash)
);

CREATE TABLE IF NOT EXISTS alert_state (
  event_type TEXT PRIMARY KEY,
  is_open INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  last_alerted_at TEXT,
  last_recovered_at TEXT
);
