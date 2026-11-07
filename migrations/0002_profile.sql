-- PR 2 (11/7/26): the profile answers, the Athlete File's notes, weigh-ins.

ALTER TABLE users ADD COLUMN weight_lb REAL;
ALTER TABLE users ADD COLUMN height_in REAL;
ALTER TABLE users ADD COLUMN sex TEXT;              -- 'F' | 'M'
ALTER TABLE users ADD COLUMN age INTEGER;
ALTER TABLE users ADD COLUMN drug TEXT;             -- as typed, normalized
ALTER TABLE users ADD COLUMN shot_day INTEGER;      -- 0 Sunday .. 6 Saturday; -1 daily pill
ALTER TABLE users ADD COLUMN lifting_days INTEGER;  -- 0..4
ALTER TABLE users ADD COLUMN goal_lb REAL;
ALTER TABLE users ADD COLUMN lean_mass_lb REAL;
ALTER TABLE users ADD COLUMN pending_field TEXT;    -- the one question in flight
ALTER TABLE users ADD COLUMN last_asked_day TEXT;   -- YYYY-MM-DD, one question a day after day one
ALTER TABLE users ADD COLUMN skipped TEXT;          -- comma-separated fields the user declined

-- The Athlete File's dated lines. Never rewritten; the weekly pass appends.
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  date       TEXT NOT NULL,       -- YYYY-MM-DD the note is about
  kind       TEXT NOT NULL,       -- injury | equipment | preference | dose | shot | travel | illness | rule | note
  text       TEXT NOT NULL,
  value      TEXT,                -- "5 mg", "231.4 lb"
  source     TEXT NOT NULL,       -- 'user' | 'coach'
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_user ON notes (user_id, id);

CREATE TABLE IF NOT EXISTS weigh_ins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  date       TEXT NOT NULL,
  lb         REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS weigh_ins_user_date ON weigh_ins (user_id, date);
