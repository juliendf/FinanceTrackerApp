-- Keep a conversation at the top of the session list.
--
-- A timestamp rather than a boolean: several pins then have a stable order (most
-- recently pinned first) and the UI can say when. NULL means "not pinned", which
-- is also what every existing row becomes.
ALTER TABLE conversations ADD COLUMN pinned_at TEXT;
