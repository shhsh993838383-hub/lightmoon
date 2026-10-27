CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  document TEXT NOT NULL,
  tmdb_id INTEGER UNIQUE,
  year INTEGER,
  minutes INTEGER,
  rating REAL,
  votes INTEGER,
  curated INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS movie_search USING fts5(movie_id UNINDEXED, tokens, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS movie_tags (movie_id TEXT, facet TEXT, tag TEXT, PRIMARY KEY(movie_id, facet, tag)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS movie_tags_lookup ON movie_tags(facet, tag, movie_id);
CREATE INDEX IF NOT EXISTS movies_year ON movies(year);
CREATE INDEX IF NOT EXISTS movies_minutes ON movies(minutes);
CREATE INDEX IF NOT EXISTS movies_curated ON movies(curated);
CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, requests INTEGER NOT NULL, expires_at INTEGER NOT NULL);
