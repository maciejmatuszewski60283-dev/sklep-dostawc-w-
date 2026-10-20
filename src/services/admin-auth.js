'use strict';
const db = require('../db');
const crypto = require('../lib/crypto');
const totp = require('../lib/totp');
const events = require('../lib/events');
const validate = require('../lib/validate');

const USER_MAX_FAILS = 5;
const IP_MAX_FAILS = 20;
const WINDOW_MS = 15 * 60 * 1000;
const IP_WINDOW_MS = 60 * 60 * 1000;

const ROLE_PERMS = {
  owner: ['*'],
  manager: ['dashboard', 'products', 'stock', 'orders', 'orders.manage', 'payments.view', 'discounts', 'pages', 'deliveries', 'logs'],
  support: ['dashboard', 'orders', 'deliveries'],
};
const ROLE_NAMES = { owner: 'Właściciel', manager: 'Menedżer', support: 'Obsługa klienta' };

function can(user, perm) {
  const p = ROLE_PERMS[user && user.role] || [];
  return p.includes('*') || p.includes(perm);
}

function failures(key, windowMs) {
  return db.get().prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND success = 0 AND ts > ?').get(key, Date.now() - windowMs).n;
}

function record(key, success) {
  db.get().prepare('INSERT INTO login_attempts (key, ts, success) VALUES (?,?,?)').run(key, Date.now(), success ? 1 : 0);
}

function isLocked(username, ip) {
  return failures(`user:${String(username).toLowerCase()}`, WINDOW_MS) >= USER_MAX_FAILS || failures(`ip:${ip}`, IP_WINDOW_MS) >= IP_MAX_FAILS;
}

/** Krok 1: login i hasło. Zwraca użytkownika albo null. */
function checkPassword(username, password, ip) {
  const name = String(username || '').trim().slice(0, 64);
  if (isLocked(name, ip)) {
    events.warn('security', 'login_locked', `Logowanie zablokowane czasowo dla "${name}"`, null, { ip });
    return { locked: true };
  }
  const user = db.get().prepare('SELECT * FROM admin_users WHERE username = ? AND active = 1').get(name);
  const ok = crypto.verifyPassword(String(password || ''), user ? user.password_hash : crypto.DUMMY_HASH) && Boolean(user);
  record(`user:${name.toLowerCase()}`, ok);
  record(`ip:${ip}`, ok);
  if (!ok) {
    events.warn('security', 'login_failed', `Nieudane logowanie do panelu (użytkownik "${name}")`, null, { ip });
    return { user: null };
  }
  return { user };
}

/** Krok 2: kod TOTP lub kod odzyskiwania. */
function checkSecondFactor(user, code, ip) {
  const key = `2fa:${user.id}`;
  if (failures(key, WINDOW_MS) >= USER_MAX_FAILS) {
    events.warn('security', '2fa_locked', `Weryfikacja 2FA zablokowana czasowo (${user.username})`, null, { ip });
    return { locked: true };
  }
  const clean = String(code || '').trim();
  const secret = crypto.decrypt(user.totp_secret_enc);
  const step = totp.verify(secret, clean, user.totp_last_step);
  if (step) {
    db.get().prepare('UPDATE admin_users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
    record(key, true);
    return { ok: true };
  }
  // Kod odzyskiwania (jednorazowy)
  const normalized = clean.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length === 10) {
    const codes = JSON.parse(user.recovery_codes || '[]');
    const h = crypto.sha256(`recovery:${normalized}`);
    const idx = codes.indexOf(h);
    if (idx >= 0) {
      codes.splice(idx, 1);
      db.get().prepare('UPDATE admin_users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes), user.id);
      events.warn('security', 'recovery_code_used', `Użyto kodu odzyskiwania (${user.username}), pozostało ${codes.length}`, null, { ip, adminUserId: user.id });
      record(key, true);
      return { ok: true, recovery: true };
    }
  }
  record(key, false);
  events.warn('security', '2fa_failed', `Błędny kod 2FA (${user.username})`, null, { ip });
  return { ok: false };
}

function generateRecoveryCodes() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const plain = [];
  for (let i = 0; i < 10; i++) {
    let s = '';
    const bytes = require('crypto').randomBytes(10);
    for (const b of bytes) s += alphabet[b % alphabet.length];
    plain.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return { plain, hashed: plain.map((c) => crypto.sha256(`recovery:${c.replace('-', '')}`)) };
}

function enableTotp(userId, secret) {
  const rc = generateRecoveryCodes();
  db.get().prepare('UPDATE admin_users SET totp_secret_enc = ?, totp_enabled = 1, totp_last_step = 0, recovery_codes = ? WHERE id = ?')
    .run(crypto.encrypt(secret), JSON.stringify(rc.hashed), userId);
  return rc.plain;
}

function createUser({ username, password, role, email = null }) {
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(name)) throw new Error('Login: 3–32 znaki (litery, cyfry, . _ -).');
  const err = validate.password(password);
  if (err) throw new Error(err);
  if (!ROLE_PERMS[role]) throw new Error('Nieznana rola.');
  return db.get().prepare('INSERT INTO admin_users (username, email, password_hash, role) VALUES (?,?,?,?)')
    .run(name, email, crypto.hashPassword(password), role).lastInsertRowid;
}

function changePassword(userId, newPassword) {
  const err = validate.password(newPassword);
  if (err) throw new Error(err);
  db.get().prepare("UPDATE admin_users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?").run(crypto.hashPassword(newPassword), userId);
}

module.exports = { can, checkPassword, checkSecondFactor, enableTotp, createUser, changePassword, isLocked, ROLE_PERMS, ROLE_NAMES, generateRecoveryCodes };
