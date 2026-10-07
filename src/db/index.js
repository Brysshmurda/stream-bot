import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { config } from '../config.js';

let _db = null;

export function getDb() {
  if (_db) return _db;
  const dbPath = resolve(config.db.path);
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS streams (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id        TEXT    UNIQUE NOT NULL,
      title            TEXT,
      started_at       TEXT    NOT NULL,
      ended_at         TEXT,
      duration_seconds INTEGER,
      peak_viewers     INTEGER DEFAULT 0,
      viewer_total     INTEGER DEFAULT 0,
      viewer_samples   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS game_segments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id        TEXT NOT NULL,
      game_id          TEXT,
      game_name        TEXT NOT NULL DEFAULT 'Unknown',
      started_at       TEXT NOT NULL,
      ended_at         TEXT,
      duration_seconds INTEGER,
      FOREIGN KEY (stream_id) REFERENCES streams(stream_id)
    );

    CREATE TABLE IF NOT EXISTS viewer_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id    TEXT NOT NULL,
      viewer_count INTEGER NOT NULL,
      recorded_at  TEXT NOT NULL,
      FOREIGN KEY (stream_id) REFERENCES streams(stream_id)
    );

    CREATE TABLE IF NOT EXISTS followers (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      twitch_user_id   TEXT UNIQUE NOT NULL,
      twitch_username  TEXT NOT NULL,
      followed_at      TEXT NOT NULL,
      discord_user_id  TEXT,
      notified         INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS discord_links (
      discord_user_id TEXT PRIMARY KEY,
      twitch_user_id  TEXT UNIQUE,
      twitch_username TEXT,
      linked_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// ── Streams ──────────────────────────────────────────────────────────────────

export function streamQueries(db = getDb()) {
  return {
    upsertStream: db.prepare(`
      INSERT INTO streams (stream_id, title, started_at)
      VALUES (@stream_id, @title, @started_at)
      ON CONFLICT(stream_id) DO NOTHING
    `),

    closeStream: db.prepare(`
      UPDATE streams
      SET ended_at = @ended_at,
          duration_seconds = @duration_seconds,
          peak_viewers = @peak_viewers,
          viewer_total = @viewer_total,
          viewer_samples = @viewer_samples
      WHERE stream_id = @stream_id
    `),

    getStream: db.prepare(`SELECT * FROM streams WHERE stream_id = ?`),

    getRecentStreams: db.prepare(`
      SELECT s.*,
             ROUND(CAST(s.viewer_total AS REAL) / NULLIF(s.viewer_samples, 0), 1) AS avg_viewers
      FROM streams s
      ORDER BY s.started_at DESC
      LIMIT ?
    `),

    addViewerSnapshot: db.prepare(`
      INSERT INTO viewer_snapshots (stream_id, viewer_count, recorded_at)
      VALUES (@stream_id, @viewer_count, @recorded_at)
    `),

    updateStreamPeak: db.prepare(`
      UPDATE streams
      SET peak_viewers = MAX(peak_viewers, @viewers),
          viewer_total = viewer_total + @viewers,
          viewer_samples = viewer_samples + 1
      WHERE stream_id = @stream_id
    `),
  };
}

// ── Game segments ────────────────────────────────────────────────────────────

export function gameQueries(db = getDb()) {
  return {
    openSegment: db.prepare(`
      INSERT INTO game_segments (stream_id, game_id, game_name, started_at)
      VALUES (@stream_id, @game_id, @game_name, @started_at)
    `),

    closeOpenSegments: db.prepare(`
      UPDATE game_segments
      SET ended_at = @ended_at,
          duration_seconds = CAST((JULIANDAY(@ended_at) - JULIANDAY(started_at)) * 86400 AS INTEGER)
      WHERE stream_id = @stream_id AND ended_at IS NULL
    `),

    topGames: db.prepare(`
      SELECT game_name,
             COUNT(DISTINCT stream_id) AS stream_count,
             SUM(duration_seconds)     AS total_seconds
      FROM game_segments
      WHERE ended_at IS NOT NULL
      GROUP BY game_name
      ORDER BY total_seconds DESC
      LIMIT ?
    `),
  };
}

// ── Followers ────────────────────────────────────────────────────────────────

export function followerQueries(db = getDb()) {
  return {
    upsertFollower: db.prepare(`
      INSERT INTO followers (twitch_user_id, twitch_username, followed_at)
      VALUES (@twitch_user_id, @twitch_username, @followed_at)
      ON CONFLICT(twitch_user_id) DO UPDATE SET twitch_username = excluded.twitch_username
    `),

    getByTwitchId: db.prepare(`SELECT * FROM followers WHERE twitch_user_id = ?`),

    setDiscordId: db.prepare(`
      UPDATE followers SET discord_user_id = ?, notified = 1 WHERE twitch_user_id = ?
    `),

    markNotified: db.prepare(`UPDATE followers SET notified = 1 WHERE twitch_user_id = ?`),
  };
}

// ── Discord links ────────────────────────────────────────────────────────────

export function linkQueries(db = getDb()) {
  return {
    upsertLink: db.prepare(`
      INSERT INTO discord_links (discord_user_id, twitch_user_id, twitch_username)
      VALUES (@discord_user_id, @twitch_user_id, @twitch_username)
      ON CONFLICT(discord_user_id) DO UPDATE
        SET twitch_user_id = excluded.twitch_user_id,
            twitch_username = excluded.twitch_username,
            linked_at = CURRENT_TIMESTAMP
    `),

    getByDiscordId: db.prepare(`SELECT * FROM discord_links WHERE discord_user_id = ?`),
    getByTwitchId: db.prepare(`SELECT * FROM discord_links WHERE twitch_user_id = ?`),
    removeByDiscordId: db.prepare(`DELETE FROM discord_links WHERE discord_user_id = ?`),
  };
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSetting(key, fallback = null) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
