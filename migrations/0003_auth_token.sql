-- Access token from the last login, reused until shortly before it expires instead of logging in on every run.
CREATE TABLE auth_token (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  account    TEXT    NOT NULL,  -- AUTH_USERNAME and AUTH_URL the token was issued for
  token      TEXT    NOT NULL,
  expires_at INTEGER NOT NULL   -- ms since epoch UTC
);

ALTER TABLE runs ADD COLUMN auth_cached INTEGER;  -- 1 = run used the cached token, no login
