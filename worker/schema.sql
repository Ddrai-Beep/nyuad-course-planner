CREATE TABLE IF NOT EXISTS votes (
  term      TEXT NOT NULL,
  course    TEXT NOT NULL,
  voter     TEXT NOT NULL,
  ip        TEXT NOT NULL,
  available INTEGER NOT NULL,
  ts        INTEGER NOT NULL,
  PRIMARY KEY (term, course, voter)
);
CREATE INDEX IF NOT EXISTS votes_term ON votes (term, course);
