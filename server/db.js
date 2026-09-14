import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// state.db:状态与记忆(SQLite,WAL 模式,不随仓库同步)
const DB_PATH = process.env.VRADIO_DB || path.join(__dirname, 'state.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// 施工图 state.db 五类数据:messages / plays / plan / prefs / player_state(当前播放与队列恢复)
db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS plays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  song_id     TEXT,
  title       TEXT NOT NULL,
  artist      TEXT,
  album       TEXT,
  cover_url   TEXT,
  duration_ms INTEGER,
  played_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS plan (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date  TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS prefs (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS player_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  playing    TEXT,
  queue      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_plays_played     ON plays(played_at);
CREATE INDEX IF NOT EXISTS idx_plan_date        ON plan(plan_date);
`);

export default db;
