'use strict';
const express = require('express');
const QRCode = require('qrcode');
const db = require('../../db');
const config = require('../../config');
const auth = require('../../services/admin-auth');
const totp = require('../../lib/totp');
const events = require('../../lib/events');
const settings = require('../../lib/settings');
const { requireAdmin, permit } = require('../../middleware/admin');
const { limits } = require('../../middleware/security');

const router = express.Router();

router.use((req, res, next) => {
  res.locals.A = config.adminPath; // prefiks adresów panelu
  res.locals.roleNames = auth.ROLE_NAMES;
  res.locals.maxFileMb = config.maxDeliveryFileMb;
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------------------
// Logowanie: hasło -> 2FA (obowiązkowe)
// ---------------------------------------------------------------------------

router.get('/login', (req, res) => {
  const hasUsers = db.get().prepare('SELECT COUNT(*) AS n FROM admin_users').get().n > 0;
  res.render('admin/login', { title: 'Logowanie', error: null, expired: req.query.wygasla === '1', hasUsers });
});

router.post('/login', limits.login, (req, res) => {
  const hasUsers = true;
  const r = auth.checkPassword(req.body.username, req.body.password, req.ip);
  if (r.locked) {
    return res.status(429).render('admin/login', { title: 'Logowanie', error: 'Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut.', expired: false, hasUsers });
  }
  if (!r.user) {
    return res.status(401).render('admin/login', { title: 'Logowanie', error: 'Nieprawidłowy login lub hasło.', expired: false, hasUsers });
  }
  req.regenerateSession();
  req.session.admin = { id: r.user.id, stage: r.user.totp_enabled ? 'totp' : 'totp_setup', authAt: Date.now(), seenAt: Date.now() };
  return res.redirect(`${config.adminPath}/2fa`);
});

function pendingUser(req) {
  const a = req.session.admin;
  if (!a || !['totp', 'totp_setup'].includes(a.stage) || Date.now() - a.authAt > 10 * 60 * 1000) return null;
  return db.get().prepare('SELECT * FROM admin_users WHERE id = ? AND active = 1').get(a.id);
}

router.get('/2fa', async (req, res) => {
  const user = pendingUser(req);
  if (!user) return res.redirect(`${config.adminPath}/login`);
  if (req.session.admin.stage === 'totp_setup') {
    if (!req.session.admin.pendingSecret) req.session.admin.pendingSecret = totp.generateSecret();
    const secret = req.session.admin.pendingSecret;
    const qr = await QRCode.toString(totp.otpauthUrl(secret, user.username, settings.get('shop.name')), { type: 'svg', margin: 1 });
    return res.render('admin/2fa-setup', { title: 'Konfiguracja 2FA', qr, secret, error: null });
  }
  res.render('admin/2fa', { title: 'Weryfikacja dwuetapowa', error: null });
});

router.post('/2fa', limits.login, async (req, res) => {
  const user = pendingUser(req);
  if (!user) return res.redirect(`${config.adminPath}/login`);
  const a = req.session.admin;
  if (a.stage === 'totp_setup') {
    const secret = a.pendingSecret;
    if (!secret || !totp.verify(secret, req.body.code)) {
      const qr = await QRCode.toString(totp.otpauthUrl(secret, user.username, settings.get('shop.name')), { type: 'svg', margin: 1 });
      return res.status(401).render('admin/2fa-setup', { title: 'Konfiguracja 2FA', qr, secret, error: 'Kod jest nieprawidłowy. Sprawdź, czy czas w telefonie jest ustawiony automatycznie.' });
    }
    const codes = auth.enableTotp(user.id, secret);
    events.info('security', '2fa_enabled', `Włączono 2FA dla ${user.username}`, null, { ip: req.ip, adminUserId: user.id });
    return finishLogin(req, res, user, codes);
  }
  const r = auth.checkSecondFactor(user, req.body.code, req.ip);
  if (r.locked) return res.status(429).render('admin/2fa', { title: 'Weryfikacja dwuetapowa', error: 'Zbyt wiele błędnych kodów. Spróbuj ponownie za 15 minut.' });
  if (!r.ok) return res.status(401).render('admin/2fa', { title: 'Weryfikacja dwuetapowa', error: 'Nieprawidłowy kod.' });
  return finishLogin(req, res, user, null);
});

function finishLogin(req, res, user, recoveryCodes) {
  req.regenerateSession();
  req.session.admin = { id: user.id, stage: 'ok', authAt: Date.now(), seenAt: Date.now() };
  db.get().prepare("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  events.info('security', 'login_success', `Zalogowano do panelu: ${user.username}`, null, { ip: req.ip, adminUserId: user.id });
  if (recoveryCodes) {
    return res.render('admin/recovery-codes', { title: 'Kody odzyskiwania', codes: recoveryCodes });
  }
  return res.redirect(config.adminPath);
}

router.post('/logout', (req, res) => {
  if (req.session.admin) events.info('security', 'logout', 'Wylogowano z panelu', null, { ip: req.ip, adminUserId: req.session.admin.id });
  req.destroySession();
  res.redirect(`${config.adminPath}/login`);
});

// ---------------------------------------------------------------------------
// Wszystko poniżej wymaga pełnego zalogowania
// ---------------------------------------------------------------------------

router.use(requireAdmin);

// Wspólne dane do menu (liczniki spraw wymagających uwagi)
router.use((req, res, next) => {
  const conn = db.get();
  res.locals.badges = {
    awaitingStock: conn.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('awaiting_stock','underpaid')").get().n,
    unmatched: conn.prepare('SELECT COUNT(*) AS n FROM unmatched_transfers WHERE assigned_payment_id IS NULL').get().n
      + conn.prepare("SELECT COUNT(*) AS n FROM payment_claims WHERE status = 'open'").get().n,
    failedEmails: conn.prepare("SELECT COUNT(*) AS n FROM emails WHERE status = 'failed'").get().n,
  };
  res.locals.audit = (type, message, meta) => events.info('admin', type, message, meta, events.fromReq(req));
  next();
});

router.get('/', permit('dashboard'), (req, res) => {
  const conn = db.get();
  const stats = {
    ordersToday: conn.prepare("SELECT COUNT(*) AS n FROM orders WHERE created_at >= date('now') AND status IN ('paid','awaiting_stock','fulfilled')").get().n,
    revenueToday: conn.prepare("SELECT COALESCE(SUM(total_minor),0) AS s FROM orders WHERE paid_at >= date('now') AND status IN ('paid','awaiting_stock','fulfilled')").get().s,
    revenue30: conn.prepare("SELECT COALESCE(SUM(total_minor),0) AS s FROM orders WHERE paid_at >= date('now','-30 days') AND status IN ('paid','awaiting_stock','fulfilled')").get().s,
    orders30: conn.prepare("SELECT COUNT(*) AS n FROM orders WHERE paid_at >= date('now','-30 days') AND status IN ('paid','awaiting_stock','fulfilled')").get().n,
    awaitingPayment: conn.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'awaiting_payment' AND expires_at > datetime('now')").get().n,
    products: conn.prepare('SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL AND active = 1').get().n,
  };
  const daily = conn.prepare(`SELECT date(paid_at) AS d, SUM(total_minor) AS s, COUNT(*) AS n FROM orders
    WHERE paid_at >= date('now','-13 days') AND status IN ('paid','awaiting_stock','fulfilled') GROUP BY date(paid_at)`).all();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const row = daily.find((r) => r.d === d);
    days.push({ d, s: row ? row.s : 0, n: row ? row.n : 0 });
  }
  const threshold = settings.getInt('stock.low_threshold', 5);
  const lowStock = conn.prepare(`SELECT p.id AS product_id, p.name AS product_name, v.id, v.name,
      (SELECT COUNT(*) FROM stock_items s WHERE s.variant_id = v.id AND s.status = 'available') AS stock
    FROM variants v JOIN products p ON p.id = v.product_id
    WHERE p.deleted_at IS NULL AND v.deleted_at IS NULL AND p.active = 1 AND v.active = 1 AND p.delivery_type = 'keys'
    AND (SELECT COUNT(*) FROM stock_items s WHERE s.variant_id = v.id AND s.status = 'available') <= ? ORDER BY stock LIMIT 10`).all(threshold);
  const attention = conn.prepare(`SELECT * FROM orders WHERE status IN ('awaiting_stock','underpaid') ORDER BY paid_at DESC, created_at DESC LIMIT 10`).all();
  const recent = conn.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 8').all();
  const paymentReady = require('../../services/payments/config').enabledAssets().length;
  const setup = {
    payments: paymentReady > 0,
    smtp: Boolean(settings.get('email.smtp_host') && settings.get('email.from_address')),
    contact: Boolean(settings.get('shop.contact_email')),
    legal: !db.get().prepare("SELECT 1 FROM pages WHERE body_md LIKE '%[DO UZUPEŁNIENIA%' LIMIT 1").get(),
    products: stats.products > 0,
  };
  res.render('admin/dashboard', { title: 'Pulpit', stats, days, lowStock, attention, recent, setup });
});

router.use(require('./products'));
router.use(require('./orders'));
router.use(require('./content'));
router.use(require('./settings'));

module.exports = router;
