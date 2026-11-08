-- PR 5 (11/8/26): found by the simulated users. A person who types meals
-- while a day-one question is pending must not get the same retry forever:
-- after two misses the question is set aside for the day and the message
-- is read as what it is.
ALTER TABLE users ADD COLUMN pending_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN deferred_day TEXT;
-- A late answer to today's question still counts after a meal came between.
ALTER TABLE users ADD COLUMN last_asked_field TEXT;
