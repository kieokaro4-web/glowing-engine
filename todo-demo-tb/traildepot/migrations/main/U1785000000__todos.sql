-- Creates the `todos` table. TrailBase applies files in migrations/main on
-- startup, versioned by the numeric prefix (U<timestamp>__<name>.sql).
--
-- The records API requires a suitable primary key: an INTEGER (SQLite rowid
-- alias). `completed` is stored as 0/1 and `created_at` as unix seconds; the
-- client maps them to boolean / ISO string so the UI matches the Supabase and
-- Nhost demos. Length check mirrors Supabase's `char_length(title) between 1
-- and 180`.
CREATE TABLE todos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
) STRICT;
