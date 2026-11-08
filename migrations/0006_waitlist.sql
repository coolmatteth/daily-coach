-- The waitlist (11/8/26): an email, once, for one message when the next
-- channel opens. Signing up for a GLP-1 coach says something about a
-- person, so this table is health information: no export to any third
-- party, deletable on request.
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,
  source     TEXT,                 -- 'site' | 'telegram'
  created_at TEXT NOT NULL
);
