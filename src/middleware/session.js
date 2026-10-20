'use strict';
// Sesje po stronie serwera (SQLite). Ciasteczko zawiera tylko losowy identyfikator; w bazie trzymamy jego skrót.
// Sesja powstaje dopiero, gdy coś do niej zapiszemy (np. koszyk) — boty nie zaśmiecają bazy.
const db = require('../db');
const config = require('../config');
const { randomToken, sha256 } = require('../lib/crypto');

const COOKIE = config.secureCookies ? '__Host-sid' : 'sid';
const TTL_MS = 7 * 24 * 3600 * 1000;

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || out[k] !== undefined) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignoruj */ }
  }
  return out;
}

function cookieString(name, value, { maxAge, sameSite = 'Lax', httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (config.secureCookies) parts.push('Secure');
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  return parts.join('; ');
}

function appendCookie(res, str) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, str) : [str]);
}

function middleware(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  const conn = db.get();
  const raw = req.cookies[COOKIE];
  let id = null;
  let data = {};
  let snapshot = '{}';
  let isNew = true;
  let destroyed = false;
  const now = Date.now();

  if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw)) {
    const row = conn.prepare('SELECT data, last_seen_at FROM sessions WHERE id_hash = ? AND expires_at > ?').get(sha256(raw), now);
    if (row) {
      id = raw;
      isNew = false;
      snapshot = row.data;
      try { data = JSON.parse(row.data); } catch { data = {}; }
      req.sessionLastSeen = row.last_seen_at;
    }
  }

  req.session = data;
  req.regenerateSession = () => {
    if (id) conn.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(id));
    id = null;
    isNew = true;
  };
  req.destroySession = () => {
    if (id) conn.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(id));
    destroyed = true;
    req.session = {};
  };

  const persist = () => {
    if (destroyed) {
      appendCookie(res, cookieString(COOKIE, '', { maxAge: 0 }));
      return;
    }
    const json = JSON.stringify(req.session || {});
    if (isNew) {
      if (json === '{}') return;
      id = randomToken(32);
      conn.prepare('INSERT INTO sessions (id_hash, data, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)')
        .run(sha256(id), json, now, now, now + TTL_MS);
      appendCookie(res, cookieString(COOKIE, id, { maxAge: TTL_MS }));
      return;
    }
    if (json !== snapshot || now - (req.sessionLastSeen || 0) > 60 * 1000) {
      conn.prepare('UPDATE sessions SET data = ?, last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(json, now, now + TTL_MS, sha256(id));
    }
  };

  const writeHead = res.writeHead;
  let done = false;
  res.writeHead = function (...args) {
    if (!done) {
      done = true;
      try { persist(); } catch (e) { console.error('[session]', e.message); }
    }
    return writeHead.apply(this, args);
  };
  next();
}

function cleanup() {
  db.get().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.get().prepare('DELETE FROM login_attempts WHERE ts < ?').run(Date.now() - 7 * 24 * 3600 * 1000);
  // Retencja zgodna z polityką prywatności: logi bezpieczeństwa i webhooki 90 dni, wykonane zadania 30 dni
  db.get().prepare("DELETE FROM events WHERE ts < datetime('now','-90 days')").run();
  db.get().prepare("DELETE FROM webhook_events WHERE received_at < datetime('now','-90 days')").run();
  db.get().prepare("DELETE FROM jobs WHERE status = 'done' AND updated_at < datetime('now','-30 days')").run();
  db.get().prepare("DELETE FROM order_access_tokens WHERE expires_at < datetime('now')").run();
}

module.exports = { middleware, cleanup, parseCookies, cookieString, appendCookie, COOKIE };
