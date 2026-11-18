-- Privacy-first, daily aggregate analytics. No raw event or visitor table.
CREATE TABLE IF NOT EXISTS daily_tool_metrics (
  day TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'unknown',
  file_size_bucket TEXT NOT NULL DEFAULT 'unknown',
  event_count INTEGER NOT NULL DEFAULT 0,
  duration_ms_total INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day, tool_id, event_type, device_type, file_size_bucket)
);

CREATE INDEX IF NOT EXISTS idx_daily_tool_metrics_day
  ON daily_tool_metrics(day);

CREATE INDEX IF NOT EXISTS idx_daily_tool_metrics_tool_day
  ON daily_tool_metrics(tool_id, day);
