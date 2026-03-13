-- ============================================================
--  VELOX D1 Database Schema
--  Run: wrangler d1 execute velox-db --file=velox_schema.sql
-- ============================================================

-- USERS
-- One row per username. No passwords yet — just a username + device token.
-- Later we can add email/password or OAuth on top.
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  token       TEXT    NOT NULL UNIQUE,   -- random secret stored in browser, proves ownership
  avatar_color TEXT   DEFAULT '#c0392b',
  created_at  INTEGER DEFAULT (unixepoch())
);

-- WATCHLIST
-- Each row = one title saved by one user
CREATE TABLE IF NOT EXISTS watchlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id     INTEGER NOT NULL,
  media_type  TEXT    NOT NULL CHECK(media_type IN ('movie','tv')),
  title       TEXT    NOT NULL,
  poster      TEXT,
  year        TEXT,
  rating      TEXT,
  added_at    INTEGER DEFAULT (unixepoch()),
  UNIQUE(user_id, tmdb_id, media_type)
);

-- WATCH HISTORY
-- Each row = one title the user clicked "Watched" or downloaded
CREATE TABLE IF NOT EXISTS history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id     INTEGER NOT NULL,
  media_type  TEXT    NOT NULL CHECK(media_type IN ('movie','tv')),
  title       TEXT    NOT NULL,
  poster      TEXT,
  watched_at  INTEGER DEFAULT (unixepoch()),
  UNIQUE(user_id, tmdb_id, media_type)
);

-- EPISODE PROGRESS  
-- Tracks which episodes a user has marked watched
CREATE TABLE IF NOT EXISTS ep_progress (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id     INTEGER NOT NULL,
  season      INTEGER NOT NULL,
  episode     INTEGER NOT NULL,
  watched_at  INTEGER DEFAULT (unixepoch()),
  UNIQUE(user_id, tmdb_id, season, episode)
);

-- COMMENTS
-- For when we add real persistent comments
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id     INTEGER NOT NULL,
  media_type  TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  spoiler     INTEGER DEFAULT 0,
  likes       INTEGER DEFAULT 0,
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  created_at  INTEGER DEFAULT (unixepoch())
);

-- INDEXES for fast lookups
CREATE INDEX IF NOT EXISTS idx_wl_user    ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_hist_user  ON history(user_id);
CREATE INDEX IF NOT EXISTS idx_ep_user    ON ep_progress(user_id, tmdb_id);
CREATE INDEX IF NOT EXISTS idx_cmt_tmdb   ON comments(tmdb_id, media_type);