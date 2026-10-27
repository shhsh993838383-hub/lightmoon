CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expiry ON user_sessions(expires_at);
CREATE TABLE IF NOT EXISTS movie_ratings (
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK(typeof(score) = 'integer' AND score BETWEEN 1 AND 10),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(movie_id, user_id)
);
CREATE INDEX IF NOT EXISTS movie_ratings_user ON movie_ratings(user_id);
CREATE TABLE IF NOT EXISTS movie_rating_totals (
  movie_id TEXT PRIMARY KEY REFERENCES movies(id) ON DELETE CASCADE,
  score_sum INTEGER NOT NULL DEFAULT 0 CHECK(score_sum >= 0),
  votes INTEGER NOT NULL DEFAULT 0 CHECK(votes >= 0)
);
CREATE TRIGGER IF NOT EXISTS movie_rating_insert AFTER INSERT ON movie_ratings BEGIN
  INSERT INTO movie_rating_totals(movie_id,score_sum,votes) VALUES (NEW.movie_id,NEW.score,1)
  ON CONFLICT(movie_id) DO UPDATE SET score_sum=score_sum+NEW.score,votes=votes+1;
END;
CREATE TRIGGER IF NOT EXISTS movie_rating_update AFTER UPDATE OF score ON movie_ratings BEGIN
  UPDATE movie_rating_totals SET score_sum=score_sum-OLD.score+NEW.score WHERE movie_id=NEW.movie_id;
END;
CREATE TRIGGER IF NOT EXISTS movie_rating_delete AFTER DELETE ON movie_ratings BEGIN
  UPDATE movie_rating_totals SET score_sum=score_sum-OLD.score,votes=votes-1 WHERE movie_id=OLD.movie_id;
  DELETE FROM movie_rating_totals WHERE movie_id=OLD.movie_id AND votes=0;
END;
CREATE TABLE IF NOT EXISTS movie_comments (
  id TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movie_comments_movie ON movie_comments(movie_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS movie_comments_user ON movie_comments(user_id);
CREATE TABLE IF NOT EXISTS user_library (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  saved INTEGER NOT NULL DEFAULT 0 CHECK(saved IN (0,1)),
  watched INTEGER NOT NULL DEFAULT 0 CHECK(watched IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,movie_id)
);
CREATE INDEX IF NOT EXISTS user_library_movie ON user_library(movie_id);
CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, requests INTEGER NOT NULL, expires_at INTEGER NOT NULL);
