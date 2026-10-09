-- One row per collection run (cron every 10 minutes, or manual).
CREATE TABLE runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,  -- scheduled time (cron) or start time (manual), ms since epoch UTC
  trigger        TEXT    NOT NULL,  -- 'cron' | 'manual'
  ok             INTEGER NOT NULL,  -- 1 = availability endpoint returned a JSON array
  error          TEXT,
  auth_status    INTEGER,
  auth_ms        INTEGER,
  avail_status   INTEGER,
  avail_ms       INTEGER,
  body_bytes     INTEGER,
  raw_key        TEXT,              -- R2 key of the raw (gzipped) response
  row_count      INTEGER,
  sku_count      INTEGER,
  qty_total      INTEGER,
  qty_current    INTEGER,           -- quantity of rows dated at or before the fetch time
  zero_rows      INTEGER,
  date_min       TEXT,              -- raw value as returned by the endpoint
  date_min_ts    INTEGER,
  date_max       TEXT,
  date_max_ts    INTEGER,
  distinct_dates INTEGER,
  invalid_dates  INTEGER,
  date_formats   TEXT               -- JSON {format: {count, example}}
);

CREATE INDEX idx_runs_ts ON runs (ts);
