-- Cloudflare can deliver one cron tick more than once (seen: two invocations ~33 s apart, scheduledTime at :17 and :50).
-- The first invocation to insert its scheduled minute here collects, the others skip.
CREATE TABLE cron_ticks (
  ts INTEGER PRIMARY KEY  -- scheduled minute, ms since epoch UTC
);

-- Drop the duplicates collected so far. Keep the last run of each minute: both wrote the same R2 key,
-- so the archived raw response is the later one's.
DELETE FROM runs WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY ts / 60000 ORDER BY ok DESC, id DESC) AS n
    FROM runs WHERE trigger = 'cron'
  ) WHERE n > 1
);

-- Cron runs are now stored at the scheduled minute.
UPDATE runs SET ts = ts / 60000 * 60000 WHERE trigger = 'cron';
INSERT INTO cron_ticks (ts) SELECT ts FROM runs WHERE trigger = 'cron';
