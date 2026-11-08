-- 11/8/26: friction the simulated users showed. A question ignored three
-- times stops being asked; a one-word meal can become a shortcut in one
-- reply.
ALTER TABLE users ADD COLUMN ask_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pending_alias_word TEXT;
ALTER TABLE users ADD COLUMN pending_alias_item TEXT;
