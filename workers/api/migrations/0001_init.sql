-- Metin Survivors API — initial schema (D1 / SQLite).
-- Times are milliseconds since the Unix epoch unless the column name says otherwise.
-- Operator note: to ban a player run
--   UPDATE players SET banned = 1 WHERE id = '<playerId>'; DELETE FROM bests WHERE player_id = '<playerId>';

CREATE TABLE players (
  id              TEXT PRIMARY KEY,                 -- 16 base64url chars, public
  name            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  banned          INTEGER NOT NULL DEFAULT 0,
  save_rev        INTEGER NOT NULL DEFAULT 0,       -- cloud save revision, 0 = none (R2 key saves/<id>.json)
  save_size       INTEGER NOT NULL DEFAULT 0,
  save_updated_at INTEGER NOT NULL DEFAULT 0
);

-- A player owns up to 8 credentials: one per device (transfer codes mint additional ones).
CREATE TABLE credentials (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,                        -- lowercase hex sha256(secret)
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_credentials_player ON credentials(player_id);

CREATE TABLE runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  client_run_id  TEXT NOT NULL,                     -- idempotency key from the client
  zone           TEXT NOT NULL,
  difficulty     TEXT NOT NULL,
  class_id       TEXT NOT NULL,
  doctrine       TEXT,
  empire         TEXT,
  sex            TEXT,
  seed           INTEGER NOT NULL,
  victory        INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  started_at     INTEGER NOT NULL,                  -- client clock: ended_at - duration
  ended_at       INTEGER NOT NULL,                  -- client clock
  created_at     INTEGER NOT NULL,                  -- server clock (arrival)
  kills          INTEGER NOT NULL,
  elites         INTEGER NOT NULL,
  bosses         INTEGER NOT NULL,
  metins         INTEGER NOT NULL,
  level          INTEGER NOT NULL,
  yeop           INTEGER NOT NULL,
  score          INTEGER NOT NULL,                  -- server recomputation
  claimed_score  INTEGER,                           -- what the client said
  status         TEXT NOT NULL CHECK (status IN ('ok', 'flagged', 'rejected')),
  flags          TEXT NOT NULL DEFAULT '',          -- comma separated reason codes
  client_version TEXT NOT NULL,
  UNIQUE (player_id, client_run_id)
);
CREATE INDEX idx_runs_player_time ON runs(player_id, ended_at);
CREATE INDEX idx_runs_status_created ON runs(status, created_at);

-- Best run per (period, zone, difficulty, class filter, player). `class_id` is a class id or '*' (all classes);
-- `period` is 'all' or 'w<weekIndex>' (UTC Monday-based week). A run upserts four rows.
CREATE TABLE bests (
  period      TEXT NOT NULL,
  zone        TEXT NOT NULL,
  difficulty  TEXT NOT NULL,
  class_id    TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  run_id      INTEGER NOT NULL,
  run_class   TEXT NOT NULL,                        -- class of the run (differs from class_id when class_id = '*')
  victory     INTEGER NOT NULL,
  level       INTEGER NOT NULL,
  kills       INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,                     -- server clock; earlier wins score ties
  PRIMARY KEY (period, zone, difficulty, class_id, player_id)
) WITHOUT ROWID;
-- Leaderboard order + rank counting: score DESC, then earliest, then player id (total order).
CREATE INDEX idx_bests_rank ON bests(period, zone, difficulty, class_id, score DESC, achieved_at ASC, player_id ASC);

-- Single-use device transfer codes; only the sha256 of the code is stored.
CREATE TABLE transfer_codes (
  code_hash  TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_transfer_player ON transfer_codes(player_id);
CREATE INDEX idx_transfer_expires ON transfer_codes(expires_at);

-- Fixed-window rate counters, one row per (rule, subject); subjects for IPs are hashed.
CREATE TABLE rate_counters (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_rate_window ON rate_counters(window_start);
