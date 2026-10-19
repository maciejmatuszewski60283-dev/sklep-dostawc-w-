'use strict';
const express = require('express');
const db = require('../../db');
const config = require('../../config');
const { permit } = require('../../middleware/admin');
const money = require('../../lib/money');
const markdown = require('../../lib/markdown');
const auth = require('../../services/admin-auth');
const discounts = require('../../services/discounts');
const crypto = require('../../lib/crypto');
const { int, str, bool } = require('../../lib/util');

const router = express.Router();
const A = () => config.adminPath;

// ---------------------------------------------------------------------------
// Kody rabatowe
// ---------------------------------------------------------------------------

router.get('/rabaty', permit('discounts'), (req, res) => {
  const rows = db.get().prepare('SELECT * FROM discount_codes ORDER BY id DESC').all().map((d) => ({ ...d, used: discounts.usedCount(d.id) }));
  res.render('admin/discounts', { title: 'Kody rabatowe', rows, edit: rows.find((r) => r.id === int(req.query.edytuj)) || null });
});

function dateOrNull(v) {
  const s = str(v, 20);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) ? s.replace('T', ' ') + (s.length === 10 ? ' 00:00:00' : ':00') : undefined;
}

router.post('/rabaty', permit('discounts'), (req, res) => {
  const code = str(req.body.code, 40).toUpperCase();
  const type = req.body.type === 'fixed' ? 'fixed' : 'percent';
  const value = type === 'percent' ? int(req.body.value) : money.parseMinor(req.body.value);
  const starts = dateOrNull(req.body.starts_at);
  const expires = dateOrNull(req.body.expires_at);
  const errors = [];
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) errors.push('Kod: 3–40 znaków (litery, cyfry, - _).');
  if (!value || value <= 0 || (type === 'percent' && value > 100)) errors.push('Nieprawidłowa wartość rabatu.');
  if (starts === undefined || expires === undefined) errors.push('Nieprawidłowa data.');
  const id = int(req.body.id);
  if (!errors.length && db.get().prepare('SELECT 1 FROM discount_codes WHERE code = ? AND id != ?').get(code, id || 0)) errors.push('Taki kod już istnieje.');
  if (errors.length) {
    req.flash('error', errors.join(' '));
    return res.redirect(`${A()}/rabaty`);
  }
  const vals = [code, type, value, money.parseMinor(req.body.min_order) || 0, str(req.body.max_uses) ? int(req.body.max_uses) : null, starts, expires, bool(req.body.active) ? 1 : 0];
  if (id) db.get().prepare('UPDATE discount_codes SET code=?, type=?, value=?, min_order_minor=?, max_uses=?, starts_at=?, expires_at=?, active=? WHERE id=?').run(...vals, id);
  else db.get().prepare('INSERT INTO discount_codes (code, type, value, min_order_minor, max_uses, starts_at, expires_at, active) VALUES (?,?,?,?,?,?,?,?)').run(...vals);
  res.locals.audit('discount_saved', `Zapisano kod rabatowy ${code}`);
  req.flash('success', `Zapisano kod ${code}.`);
  res.redirect(`${A()}/rabaty`);
});

router.post('/rabaty/:id/usun', permit('discounts'), (req, res) => {
  const id = int(req.params.id);
  if (db.get().prepare('SELECT 1 FROM orders WHERE discount_code_id = ?').get(id)) {
    db.get().prepare('UPDATE discount_codes SET active = 0 WHERE id = ?').run(id);
    req.flash('success', 'Kod był użyty w zamówieniach, więc został wyłączony (historia zachowana).');
  } else {
    db.get().prepare('DELETE FROM discount_codes WHERE id = ?').run(id);
    req.flash('success', 'Usunięto kod.');
  }
  res.redirect(`${A()}/rabaty`);
});

// ---------------------------------------------------------------------------
// Strony informacyjne (regulamin, polityka prywatności, ...)
// ---------------------------------------------------------------------------

router.get('/strony', permit('pages'), (req, res) => {
  const rows = db.get().prepare("SELECT slug, title, show_in_footer, sort, updated_at, body_md LIKE '%[DO UZUPEŁNIENIA%' AS todo FROM pages ORDER BY sort, title").all();
  res.render('admin/pages', { title: 'Strony i treści', rows });
});

router.get('/strony/nowa', permit('pages'), (req, res) => {
  res.render('admin/page-form', { title: 'Nowa strona', page: null, preview: null });
});

router.get('/strony/:slug', permit('pages'), (req, res, next) => {
  const page = db.get().prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  if (!page) return next();
  res.render('admin/page-form', { title: `Edycja: ${page.title}`, page, preview: markdown.render(page.body_md) });
});

router.post('/strony', permit('pages'), (req, res) => {
  const title = str(req.body.title, 120);
  const slug = require('../../lib/util').slugify(str(req.body.slug) || title);
  const original = str(req.body.original_slug, 100);
  if (title.length < 2) { req.flash('error', 'Podaj tytuł.'); return res.redirect(`${A()}/strony`); }
  const conn = db.get();
  if (original) {
    if (slug !== original && conn.prepare('SELECT 1 FROM pages WHERE slug = ?').get(slug)) { req.flash('error', 'Strona o takim adresie już istnieje.'); return res.redirect(`${A()}/strony/${original}`); }
    conn.prepare("UPDATE pages SET slug=?, title=?, body_md=?, show_in_footer=?, sort=?, updated_at=datetime('now') WHERE slug=?")
      .run(slug, title, str(req.body.body_md, 100000), bool(req.body.show_in_footer) ? 1 : 0, int(req.body.sort), original);
  } else {
    if (conn.prepare('SELECT 1 FROM pages WHERE slug = ?').get(slug)) { req.flash('error', 'Strona o takim adresie już istnieje.'); return res.redirect(`${A()}/strony/nowa`); }
    conn.prepare('INSERT INTO pages (slug, title, body_md, show_in_footer, sort) VALUES (?,?,?,?,?)')
      .run(slug, title, str(req.body.body_md, 100000), bool(req.body.show_in_footer) ? 1 : 0, int(req.body.sort));
  }
  res.locals.audit('page_saved', `Zapisano stronę „${title}”`);
  req.flash('success', 'Zapisano stronę.');
  res.redirect(`${A()}/strony/${slug}`);
});

router.post('/strony/:slug/usun', permit('pages'), (req, res) => {
  if (['regulamin', 'polityka-prywatnosci'].includes(req.params.slug)) {
    req.flash('error', 'Regulaminu i polityki prywatności nie można usunąć — są wymagane prawem.');
  } else {
    db.get().prepare('DELETE FROM pages WHERE slug = ?').run(req.params.slug);
    req.flash('success', 'Usunięto stronę.');
  }
  res.redirect(`${A()}/strony`);
});

// ---------------------------------------------------------------------------
// Dziennik zdarzeń
// ---------------------------------------------------------------------------

router.get('/logi', permit('logs'), (req, res) => {
  const category = str(req.query.kategoria, 30);
  const level = str(req.query.poziom, 10);
  const where = ['1=1'];
  const params = [];
  if (['security', 'payment', 'order', 'system', 'admin', 'email'].includes(category)) { where.push('category = ?'); params.push(category); }
  if (['info', 'warn', 'error'].includes(level)) { where.push('level = ?'); params.push(level); }
  const rows = db.get().prepare(`SELECT e.*, u.username FROM events e LEFT JOIN admin_users u ON u.id = e.admin_user_id WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT 300`).all(...params);
  res.render('admin/logs', { title: 'Dziennik zdarzeń', rows, category, level });
});

// ---------------------------------------------------------------------------
// Użytkownicy panelu (tylko właściciel)
// ---------------------------------------------------------------------------

router.get('/uzytkownicy', permit('users'), (req, res) => {
  const rows = db.get().prepare('SELECT id, username, email, role, active, totp_enabled, last_login_at, created_at FROM admin_users ORDER BY id').all();
  res.render('admin/users', { title: 'Użytkownicy panelu', rows });
});

router.post('/uzytkownicy', permit('users'), (req, res) => {
  try {
    auth.createUser({ username: req.body.username, password: req.body.password, role: req.body.role, email: str(req.body.email, 200) || null });
    res.locals.audit('user_created', `Utworzono konto panelu ${str(req.body.username, 40)} (${req.body.role})`);
    req.flash('success', 'Utworzono konto. Przy pierwszym logowaniu użytkownik skonfiguruje 2FA.');
  } catch (e) {
    req.flash('error', e.message.includes('UNIQUE') ? 'Taki login już istnieje.' : e.message);
  }
  res.redirect(`${A()}/uzytkownicy`);
});

router.post('/uzytkownicy/:id', permit('users'), (req, res) => {
  const id = int(req.params.id);
  const conn = db.get();
  const target = conn.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
  if (!target) return res.redirect(`${A()}/uzytkownicy`);
  const owners = conn.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE role='owner' AND active=1").get().n;
  const action = req.body.action;
  if (target.id === req.admin.id && action !== 'reset2fa') {
    req.flash('error', 'Nie możesz zmienić roli ani wyłączyć własnego konta.');
  } else if (action === 'toggle') {
    if (target.active && target.role === 'owner' && owners <= 1) req.flash('error', 'Musi pozostać co najmniej jeden aktywny właściciel.');
    else {
      conn.prepare('UPDATE admin_users SET active = ? WHERE id = ?').run(target.active ? 0 : 1, id);
      res.locals.audit('user_toggled', `${target.active ? 'Wyłączono' : 'Włączono'} konto ${target.username}`);
    }
  } else if (action === 'role' && auth.ROLE_PERMS[req.body.role]) {
    if (target.role === 'owner' && req.body.role !== 'owner' && owners <= 1) req.flash('error', 'Musi pozostać co najmniej jeden właściciel.');
    else {
      conn.prepare('UPDATE admin_users SET role = ? WHERE id = ?').run(req.body.role, id);
      res.locals.audit('user_role', `Zmieniono rolę ${target.username} na ${req.body.role}`);
    }
  } else if (action === 'reset2fa') {
    conn.prepare("UPDATE admin_users SET totp_enabled = 0, totp_secret_enc = NULL, recovery_codes = '[]', password_changed_at = datetime('now') WHERE id = ?").run(id);
    res.locals.audit('user_2fa_reset', `Zresetowano 2FA konta ${target.username}`);
    req.flash('success', 'Zresetowano 2FA. Użytkownik skonfiguruje je ponownie przy logowaniu.');
    if (target.id === req.admin.id) { req.destroySession(); return res.redirect(`${A()}/login`); }
  }
  res.redirect(`${A()}/uzytkownicy`);
});

// ---------------------------------------------------------------------------
// Moje konto
// ---------------------------------------------------------------------------

router.get('/konto', (req, res) => {
  const user = db.get().prepare('SELECT recovery_codes FROM admin_users WHERE id = ?').get(req.admin.id);
  res.render('admin/account', { title: 'Moje konto', recoveryLeft: JSON.parse(user.recovery_codes || '[]').length, codes: null });
});

router.post('/konto/haslo', (req, res) => {
  const user = db.get().prepare('SELECT * FROM admin_users WHERE id = ?').get(req.admin.id);
  if (!crypto.verifyPassword(req.body.current, user.password_hash)) {
    req.flash('error', 'Obecne hasło jest nieprawidłowe.');
    return res.redirect(`${A()}/konto`);
  }
  if (req.body.password !== req.body.password2) {
    req.flash('error', 'Nowe hasła nie są identyczne.');
    return res.redirect(`${A()}/konto`);
  }
  try {
    auth.changePassword(user.id, req.body.password);
    res.locals.audit('password_changed', `Zmieniono hasło (${user.username})`);
    req.destroySession();
    return res.redirect(`${A()}/login`);
  } catch (e) {
    req.flash('error', e.message);
    return res.redirect(`${A()}/konto`);
  }
});

router.post('/konto/kody', (req, res) => {
  const rc = auth.generateRecoveryCodes();
  db.get().prepare('UPDATE admin_users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(rc.hashed), req.admin.id);
  res.locals.audit('recovery_regenerated', 'Wygenerowano nowe kody odzyskiwania');
  res.render('admin/account', { title: 'Moje konto', recoveryLeft: rc.plain.length, codes: rc.plain });
});

module.exports = router;
