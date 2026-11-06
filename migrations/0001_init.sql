-- GLP-1 Coach, schema 1 (PR 1, 11/6/26). Every table that holds something a
-- person typed carries their user_id, so `/delete me` is a handful of
-- deletes and nothing is left behind.

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel    TEXT NOT NULL,          -- 'telegram' | 'sim'
  chat_id    TEXT NOT NULL,          -- the channel's id for this person
  created_at TEXT NOT NULL,          -- ISO timestamp
  tz         TEXT,                   -- IANA zone, asked during onboarding (PR 2)
  UNIQUE (channel, chat_id)
);

-- One row per model call, so the daily cap is a count and the real cost
-- can be measured in week one instead of guessed.
CREATE TABLE IF NOT EXISTS model_calls (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day     TEXT NOT NULL,             -- YYYY-MM-DD
  kind    TEXT NOT NULL,             -- 'meal' | 'plan' | ...
  at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS model_calls_user_day ON model_calls (user_id, day);

-- Where staging's messages go instead of Telegram, and where the simulated
-- users read what the bot said.
CREATE TABLE IF NOT EXISTS outbox (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  text    TEXT NOT NULL,
  at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_chat ON outbox (channel, chat_id, id);

-- Small worker-wide state. Today only the staging test clock.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
