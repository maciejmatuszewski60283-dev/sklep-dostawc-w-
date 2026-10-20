'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

let db;

function migrate(conn) {
  conn.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(conn.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    conn.transaction(() => {
      conn.exec(sql);
      conn.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime('now'))").run(f);
    })();
  }
}

function open(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  conn.pragma('synchronous = NORMAL');
  migrate(conn);
  return conn;
}

function get() {
  if (!db) db = open();
  return db;
}

/** Tylko dla testów: podmienia połączenie. */
function _set(conn) {
  db = conn;
}

module.exports = { get, open, _set, tx: (fn) => get().transaction(fn)() };
