-- PR 4 (11/8/26): the training bot. One row per set; the plan the user was
-- sent for a day; the rest-day check-in.

CREATE TABLE IF NOT EXISTS sets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  day        TEXT NOT NULL,            -- the session's day, YYYY-MM-DD
  key        TEXT NOT NULL,            -- normalized lift name (progression.liftKey)
  exercise   TEXT NOT NULL,            -- as typed or as planned
  set_index  INTEGER NOT NULL,
  weight     REAL NOT NULL,
  reps       INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sets_user_key_day ON sets (user_id, key, day, set_index);
CREATE INDEX IF NOT EXISTS sets_user_day ON sets (user_id, day);

CREATE TABLE IF NOT EXISTS plans (
  user_id    INTEGER NOT NULL,
  day        TEXT NOT NULL,
  plan       TEXT NOT NULL,            -- JSON Plan
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS checkins (
  user_id    INTEGER NOT NULL,
  day        TEXT NOT NULL,
  stomach    INTEGER NOT NULL,         -- 1..5
  energy     INTEGER NOT NULL,         -- 1..5
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE users ADD COLUMN last_plan_day TEXT;        -- the evening send already ran for this local day
ALTER TABLE users ADD COLUMN pending_checkin_day TEXT;  -- a check-in was asked for this day
