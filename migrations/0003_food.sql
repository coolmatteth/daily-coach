-- PR 3 (11/7/26): the Food Log. One row per meal, per user; shortcuts;
-- the pending guess; a per-user lock so two fast messages never lose a write.

CREATE TABLE IF NOT EXISTS meals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  day        TEXT NOT NULL,            -- YYYY-MM-DD in the user's time zone
  at         TEXT NOT NULL,            -- ISO
  text       TEXT NOT NULL,
  photo      INTEGER NOT NULL DEFAULT 0,
  items      TEXT NOT NULL,            -- JSON [{name, protein_g, kcal}]
  protein_g  REAL NOT NULL,
  kcal       REAL NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meals_user_day ON meals (user_id, day, at, id);

CREATE TABLE IF NOT EXISTS aliases (
  user_id   INTEGER NOT NULL,
  word      TEXT NOT NULL,
  name      TEXT NOT NULL,
  protein_g REAL NOT NULL,
  kcal      REAL NOT NULL,
  PRIMARY KEY (user_id, word)
);

-- One in-flight message per user. The row is the lock; `until` lets a
-- crashed handler's lock expire.
CREATE TABLE IF NOT EXISTS locks (
  user_id INTEGER PRIMARY KEY,
  until   TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN pending_meal TEXT;
ALTER TABLE users ADD COLUMN pending_until TEXT;
ALTER TABLE users ADD COLUMN last_recap_day TEXT;
