-- Co-op runs rank on their own boards: runs carry their party size, `bests` gains a `mode` key column.
-- (SQLite cannot alter a primary key, so `bests` is rebuilt; existing rows become mode 'solo'.)
ALTER TABLE runs ADD COLUMN coop INTEGER NOT NULL DEFAULT 1; -- party size: 1 = solo, 2..4 = co-op

CREATE TABLE bests_v2 (
  mode        TEXT NOT NULL CHECK (mode IN ('solo', 'coop')),
  period      TEXT NOT NULL,
  zone        TEXT NOT NULL,
  difficulty  TEXT NOT NULL,
  class_id    TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  run_id      INTEGER NOT NULL,
  run_class   TEXT NOT NULL,
  party       INTEGER NOT NULL DEFAULT 1,
  victory     INTEGER NOT NULL,
  level       INTEGER NOT NULL,
  kills       INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (mode, period, zone, difficulty, class_id, player_id)
) WITHOUT ROWID;

INSERT INTO bests_v2 (mode, period, zone, difficulty, class_id, player_id, score, run_id, run_class, party, victory, level, kills, duration_ms, achieved_at)
  SELECT 'solo', period, zone, difficulty, class_id, player_id, score, run_id, run_class, 1, victory, level, kills, duration_ms, achieved_at
    FROM bests;

DROP TABLE bests;
ALTER TABLE bests_v2 RENAME TO bests;

CREATE INDEX idx_bests_rank ON bests(mode, period, zone, difficulty, class_id, score DESC, achieved_at ASC, player_id ASC);
