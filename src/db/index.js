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
  migrate(_db);
  return _db;
}

// ── Schema + migrations ───────────────────────────────────────────────────────

const TABLES = {
  account_guilds: `
    CREATE TABLE IF NOT EXISTS account_guilds (
      account_id TEXT NOT NULL,
      guild_id   TEXT NOT NULL,
      PRIMARY KEY (account_id, guild_id)
    )`,
  accounts: `
    CREATE TABLE IF NOT EXISTS accounts (
      id                    TEXT PRIMARY KEY,
      twitch_channel        TEXT UNIQUE NOT NULL,
      twitch_broadcaster_id TEXT UNIQUE NOT NULL,
      discord_guild_id      TEXT,
      access_token          TEXT NOT NULL,
      refresh_token         TEXT NOT NULL,
      enabled               INTEGER DEFAULT 1,
      created_at            TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
  streams: `
    CREATE TABLE IF NOT EXISTS streams (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       TEXT NOT NULL DEFAULT 'default',
      stream_id        TEXT NOT NULL,
      title            TEXT,
      started_at       TEXT NOT NULL,
      ended_at         TEXT,
      duration_seconds INTEGER,
      peak_viewers     INTEGER DEFAULT 0,
      viewer_total     INTEGER DEFAULT 0,
      viewer_samples   INTEGER DEFAULT 0,
      UNIQUE(account_id, stream_id)
    )`,
  game_segments: `
    CREATE TABLE IF NOT EXISTS game_segments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       TEXT NOT NULL DEFAULT 'default',
      stream_id        TEXT NOT NULL,
      game_id          TEXT,
      game_name        TEXT NOT NULL DEFAULT 'Unknown',
      started_at       TEXT NOT NULL,
      ended_at         TEXT,
      duration_seconds INTEGER
    )`,
  viewer_snapshots: `
    CREATE TABLE IF NOT EXISTS viewer_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id   TEXT NOT NULL DEFAULT 'default',
      stream_id    TEXT NOT NULL,
      viewer_count INTEGER NOT NULL,
      recorded_at  TEXT NOT NULL
    )`,
  followers: `
    CREATE TABLE IF NOT EXISTS followers (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       TEXT NOT NULL DEFAULT 'default',
      twitch_user_id   TEXT NOT NULL,
      twitch_username  TEXT NOT NULL,
      followed_at      TEXT NOT NULL,
      discord_user_id  TEXT,
      notified         INTEGER DEFAULT 0,
      UNIQUE(account_id, twitch_user_id)
    )`,
  discord_links: `
    CREATE TABLE IF NOT EXISTS discord_links (
      account_id      TEXT NOT NULL DEFAULT 'default',
      discord_user_id TEXT NOT NULL,
      twitch_user_id  TEXT,
      twitch_username TEXT,
      linked_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, discord_user_id)
    )`,
  settings: `
    CREATE TABLE IF NOT EXISTS settings (
      account_id TEXT NOT NULL DEFAULT 'default',
      key        TEXT NOT NULL,
      value      TEXT,
      PRIMARY KEY (account_id, key)
    )`,
  twitch_strikes: `
    CREATE TABLE IF NOT EXISTS twitch_strikes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       TEXT NOT NULL DEFAULT 'default',
      twitch_user_id   TEXT NOT NULL,
      twitch_username  TEXT NOT NULL,
      strikes          INTEGER DEFAULT 0,
      last_reason      TEXT,
      last_action_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, twitch_user_id)
    )`,
  discord_warnings: `
    CREATE TABLE IF NOT EXISTS discord_warnings (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     TEXT NOT NULL DEFAULT 'default',
      guild_id       TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      moderator_id   TEXT NOT NULL,
      reason         TEXT,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
  banned_words: `
    CREATE TABLE IF NOT EXISTS banned_words (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL DEFAULT 'default',
      word       TEXT NOT NULL,
      action     TEXT NOT NULL DEFAULT 'delete',
      duration   INTEGER DEFAULT 300,
      added_by   TEXT,
      UNIQUE(account_id, word)
    )`,
};

const columns = (db, table) => db.pragma(`table_info(${table})`).map(c => c.name);

function hasUniqueOn(db, table, column) {
  return db.pragma(`index_list(${table})`).some(idx => {
    if (!idx.unique) return false;
    const cols = db.pragma(`index_info(${idx.name})`);
    return cols.length === 1 && cols[0].name === column;
  });
}

// Recreate a table from its canonical DDL, copying over the columns both versions share.
function rebuild(db, table, extra = {}) {
  const oldCols = columns(db, table);
  db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy`);
  db.exec(TABLES[table]);
  const newCols = columns(db, table);
  const shared = oldCols.filter(c => newCols.includes(c) && !(c in extra));
  const insertCols = [...Object.keys(extra), ...shared];
  const selectExprs = [...Object.keys(extra).map(k => `@${k}`), ...shared];
  const copy = db.prepare(`INSERT OR IGNORE INTO ${table} (${insertCols.join(',')}) SELECT ${selectExprs.join(',')} FROM ${table}_legacy`);
  if (Object.keys(extra).length) copy.run(extra); else copy.run();
  db.exec(`DROP TABLE ${table}_legacy`);
  console.log(`[db] Migrated legacy table: ${table}`);
}

// Idempotent: inspects the real table structure instead of trusting user_version,
// because pre-multi-account databases never set it.
function migrate(db) {
  // Data from the single-account era belongs to the account seeded from .env
  const legacyAccountId = config.twitch.broadcasterId || 'default';

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const [table, ddl] of Object.entries(TABLES)) {
      const cols = columns(db, table);
      if (cols.length === 0) db.exec(ddl);
      else if (table !== 'accounts' && !cols.includes('account_id')) rebuild(db, table, { account_id: legacyAccountId });
    }

    // Allow multiple Twitch accounts per Discord server
    if (hasUniqueOn(db, 'accounts', 'discord_guild_id')) rebuild(db, 'accounts');

    // Discord-side settings moved from per-account to per-server; the oldest account's values win
    const guildKeyFilter = `(s.key LIKE 'channel\\_%' ESCAPE '\\' OR s.key LIKE 'role\\_%' ESCAPE '\\' OR s.key LIKE 'notify\\_%' ESCAPE '\\')`;
    db.exec(`
      INSERT OR IGNORE INTO settings (account_id, key, value)
      SELECT 'guild_' || a.discord_guild_id, s.key, s.value
      FROM settings s JOIN accounts a ON a.id = s.account_id
      WHERE a.discord_guild_id IS NOT NULL AND ${guildKeyFilter}
      ORDER BY a.created_at;
      DELETE FROM settings AS s
      WHERE s.account_id IN (SELECT id FROM accounts WHERE discord_guild_id IS NOT NULL) AND ${guildKeyFilter};
    `);

    // One Twitch channel can be connected to many Discord servers; accounts.discord_guild_id is retired
    db.exec(`
      INSERT OR IGNORE INTO account_guilds (account_id, guild_id)
      SELECT id, discord_guild_id FROM accounts WHERE discord_guild_id IS NOT NULL AND enabled = 1;
      UPDATE accounts SET discord_guild_id = NULL WHERE discord_guild_id IS NOT NULL;
    `);
  })();
  db.pragma('foreign_keys = ON');
  db.pragma('user_version = 3');
}

// ── Account queries ───────────────────────────────────────────────────────────

export function accountQueries(db = getDb()) {
  return {
    upsert: db.prepare(`
      INSERT INTO accounts (id, twitch_channel, twitch_broadcaster_id, access_token, refresh_token)
      VALUES (@id, @twitch_channel, @twitch_broadcaster_id, @access_token, @refresh_token)
      ON CONFLICT(id) DO UPDATE SET
        twitch_channel = excluded.twitch_channel,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        enabled = 1
    `),
    getAll:          db.prepare(`SELECT * FROM accounts WHERE enabled = 1`),
    getById:         db.prepare(`SELECT * FROM accounts WHERE id = ?`),
    getByChannel:    db.prepare(`SELECT * FROM accounts WHERE twitch_channel = ?`),
    addGuild:        db.prepare(`INSERT OR IGNORE INTO account_guilds (account_id, guild_id) VALUES (?, ?)`),
    removeGuild:     db.prepare(`DELETE FROM account_guilds WHERE account_id = ? AND guild_id = ?`),
    guildsFor:       db.prepare(`SELECT guild_id FROM account_guilds WHERE account_id = ?`),
    updateTokens:    db.prepare(`UPDATE accounts SET access_token = ?, refresh_token = ? WHERE id = ?`),
    disable:         db.prepare(`UPDATE accounts SET enabled = 0 WHERE id = ?`),
    delete:          db.prepare(`DELETE FROM accounts WHERE id = ?`),
  };
}

// ── Scoped query factory ──────────────────────────────────────────────────────
// Returns all query sets pre-bound to an accountId

export function scopedQueries(accountId, db = getDb()) {
  if (!/^[\w-]+$/.test(String(accountId))) throw new Error(`Invalid accountId: ${accountId}`);
  return {
    streams: {
      upsert: db.prepare(`
        INSERT INTO streams (account_id, stream_id, title, started_at)
        VALUES ('${accountId}', @stream_id, @title, @started_at)
        ON CONFLICT(account_id, stream_id) DO NOTHING
      `),
      close: db.prepare(`
        UPDATE streams SET ended_at=@ended_at, duration_seconds=@duration_seconds,
          peak_viewers=@peak_viewers, viewer_total=@viewer_total, viewer_samples=@viewer_samples
        WHERE account_id='${accountId}' AND stream_id=@stream_id
      `),
      get: db.prepare(`SELECT * FROM streams WHERE account_id='${accountId}' AND stream_id=?`),
      getRecent: db.prepare(`
        SELECT *, ROUND(CAST(viewer_total AS REAL)/NULLIF(viewer_samples,0),1) AS avg_viewers
        FROM streams WHERE account_id='${accountId}' ORDER BY started_at DESC LIMIT ?
      `),
      addSnapshot: db.prepare(`
        INSERT INTO viewer_snapshots (account_id, stream_id, viewer_count, recorded_at)
        VALUES ('${accountId}', @stream_id, @viewer_count, @recorded_at)
      `),
      updatePeak: db.prepare(`
        UPDATE streams SET peak_viewers=MAX(peak_viewers,@viewers),
          viewer_total=viewer_total+@viewers, viewer_samples=viewer_samples+1
        WHERE account_id='${accountId}' AND stream_id=@stream_id
      `),
    },

    games: {
      open: db.prepare(`
        INSERT INTO game_segments (account_id, stream_id, game_id, game_name, started_at)
        VALUES ('${accountId}', @stream_id, @game_id, @game_name, @started_at)
      `),
      closeOpen: db.prepare(`
        UPDATE game_segments
        SET ended_at=@ended_at,
            duration_seconds=CAST((JULIANDAY(@ended_at)-JULIANDAY(started_at))*86400 AS INTEGER)
        WHERE account_id='${accountId}' AND stream_id=@stream_id AND ended_at IS NULL
      `),
      topGames: db.prepare(`
        SELECT game_name, COUNT(DISTINCT stream_id) AS stream_count, SUM(duration_seconds) AS total_seconds
        FROM game_segments WHERE account_id='${accountId}' AND ended_at IS NOT NULL
        GROUP BY game_name ORDER BY total_seconds DESC LIMIT ?
      `),
    },

    followers: {
      upsert: db.prepare(`
        INSERT INTO followers (account_id, twitch_user_id, twitch_username, followed_at)
        VALUES ('${accountId}', @twitch_user_id, @twitch_username, @followed_at)
        ON CONFLICT(account_id, twitch_user_id) DO UPDATE SET twitch_username=excluded.twitch_username
      `),
      getByTwitchId: db.prepare(`SELECT * FROM followers WHERE account_id='${accountId}' AND twitch_user_id=?`),
    },

    links: {
      upsert: db.prepare(`
        INSERT INTO discord_links (account_id, discord_user_id, twitch_user_id, twitch_username)
        VALUES ('${accountId}', @discord_user_id, @twitch_user_id, @twitch_username)
        ON CONFLICT(account_id, discord_user_id) DO UPDATE SET
          twitch_user_id=excluded.twitch_user_id, twitch_username=excluded.twitch_username, linked_at=CURRENT_TIMESTAMP
      `),
      getByDiscordId: db.prepare(`SELECT * FROM discord_links WHERE account_id='${accountId}' AND discord_user_id=?`),
      getByTwitchId:  db.prepare(`SELECT * FROM discord_links WHERE account_id='${accountId}' AND twitch_user_id=?`),
      remove:         db.prepare(`DELETE FROM discord_links WHERE account_id='${accountId}' AND discord_user_id=?`),
    },

    settings: {
      get:    db.prepare(`SELECT value FROM settings WHERE account_id='${accountId}' AND key=?`),
      set:    db.prepare(`INSERT INTO settings (account_id,key,value) VALUES ('${accountId}',?,?) ON CONFLICT(account_id,key) DO UPDATE SET value=excluded.value`),
      delete: db.prepare(`DELETE FROM settings WHERE account_id='${accountId}' AND key=?`),
      getAll: db.prepare(`SELECT key, value FROM settings WHERE account_id='${accountId}'`),
    },

    strikes: {
      get:   db.prepare(`SELECT * FROM twitch_strikes WHERE account_id='${accountId}' AND twitch_user_id=?`),
      add:   db.prepare(`
        INSERT INTO twitch_strikes (account_id, twitch_user_id, twitch_username, strikes, last_reason)
        VALUES ('${accountId}', @twitch_user_id, @twitch_username, 1, @reason)
        ON CONFLICT(account_id, twitch_user_id) DO UPDATE SET
          strikes=strikes+1, twitch_username=excluded.twitch_username,
          last_reason=excluded.last_reason, last_action_at=CURRENT_TIMESTAMP
      `),
      reset: db.prepare(`DELETE FROM twitch_strikes WHERE account_id='${accountId}' AND twitch_user_id=?`),
    },

    warnings: {
      add:   db.prepare(`INSERT INTO discord_warnings (account_id,guild_id,user_id,moderator_id,reason) VALUES ('${accountId}',@guild_id,@user_id,@moderator_id,@reason)`),
      get:   db.prepare(`SELECT * FROM discord_warnings WHERE account_id='${accountId}' AND guild_id=? AND user_id=? ORDER BY created_at DESC`),
      clear: db.prepare(`DELETE FROM discord_warnings WHERE account_id='${accountId}' AND guild_id=? AND user_id=?`),
      count: db.prepare(`SELECT COUNT(*) as count FROM discord_warnings WHERE account_id='${accountId}' AND guild_id=? AND user_id=?`),
    },

    bannedWords: {
      add:    db.prepare(`INSERT INTO banned_words (account_id,word,action,duration,added_by) VALUES ('${accountId}',@word,@action,@duration,@added_by) ON CONFLICT(account_id,word) DO UPDATE SET action=excluded.action, duration=excluded.duration`),
      remove: db.prepare(`DELETE FROM banned_words WHERE account_id='${accountId}' AND word=?`),
      getAll: db.prepare(`SELECT * FROM banned_words WHERE account_id='${accountId}' ORDER BY word`),
    },
  };
}

// ── Helper wrappers ───────────────────────────────────────────────────────────

// A Discord↔Twitch link belongs to the person, not to one streamer, so lookups ignore account_id
// (older links were saved under whichever account the command ran against).
export function findDiscordUserByTwitchId(twitchUserId) {
  const row = getDb().prepare(`SELECT discord_user_id FROM discord_links WHERE twitch_user_id = ? ORDER BY linked_at DESC LIMIT 1`).get(twitchUserId);
  return row?.discord_user_id ?? null;
}

export function getLinkByDiscordId(discordUserId) {
  return getDb().prepare(`SELECT * FROM discord_links WHERE discord_user_id = ? ORDER BY linked_at DESC LIMIT 1`).get(discordUserId) ?? null;
}

export function removeLinks(discordUserId) {
  return getDb().prepare(`DELETE FROM discord_links WHERE discord_user_id = ?`).run(discordUserId).changes;
}

// A Twitch account can be claimed by only one Discord user; returns the current owner if taken.
export function saveLink(guildId, link) {
  return getDb().transaction(() => {
    const owner = getDb()
      .prepare(`SELECT discord_user_id FROM discord_links WHERE twitch_user_id = ? AND discord_user_id != ? LIMIT 1`)
      .get(link.twitch_user_id, link.discord_user_id);
    if (owner) return { ok: false, ownerId: owner.discord_user_id };
    removeLinks(link.discord_user_id);
    scopedQueries(guildScope(guildId)).links.upsert.run(link);
    return { ok: true };
  })();
}

export function getSetting(accountId, key, fallback = null) {
  const row = scopedQueries(accountId).settings.get.get(key);
  return row ? row.value : fallback;
}

// Channels, roles and notification toggles belong to the Discord server and are shared by
// every Twitch account linked to it; everything else (automod etc.) stays per account.
const GUILD_KEY = /^(channel_|role_|notify_)/;
export const guildScope = (guildId) => `guild_${guildId}`;
const scopeFor = (accountId, guildId, key) => GUILD_KEY.test(key) && guildId ? guildScope(guildId) : accountId;

export function getScopedSetting(accountId, guildId, key, fallback = null) {
  return getSetting(scopeFor(accountId, guildId, key), key, fallback);
}

export function setScopedSetting(accountId, guildId, key, value) {
  setSetting(scopeFor(accountId, guildId, key), key, value);
}

export function setSetting(accountId, key, value) {
  if (value === null || value === undefined) {
    scopedQueries(accountId).settings.delete.run(key);
  } else {
    scopedQueries(accountId).settings.set.run(key, String(value));
  }
}
