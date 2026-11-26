-- Revision-specific save blob keys for atomic cloud-save publication, plus persisted cron sweep cursor state.

ALTER TABLE players ADD COLUMN save_blob TEXT NOT NULL DEFAULT '';

CREATE TABLE cron_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
