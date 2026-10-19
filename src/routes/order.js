'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const orders = require('../services/orders');
const delivery = require('../services/delivery');
const payments = require('../services/payments');
const email = require('../services/email');
const validate = require('../lib/validate');
const events = require('../lib/events');
const crypto = require('../lib/crypto');
const { atomicToDecimal } = require('../lib/money');
const { parseDbDate } = require('../lib/util');
const { ASSETS } = require('../services/payments/assets');
const { limits } = require('../middleware/security');

const router = express.Router();

router.use(['/zamowienie', '/pobierz'], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  res.locals.footerPages = db.get().prepare('SELECT slug, title FROM pages WHERE show_in_footer = 1 ORDER BY sort, title').all();
  next();
});

/** Klient ma dostęp do zamówienia, jeśli otworzył link z e-maila (token) w tej przeglądarce. */
function loadOrder(req, res, next) {
  const order = orders.byPublicId(req.params.pid);
  if (!order) return res.status(404).render('shop/error', { title: 'Nie znaleziono zamówienia', message: 'Sprawdź link z wiadomości e-mail.' });
  const granted = req.session.orders && req.session.orders[order.public_id];
  if (!granted) {
    return res.status(403).render('shop/error', {
      title: 'Brak dostępu',
      message: 'Otwórz zamówienie, korzystając z linku z wiadomości e-mail. Jeśli go nie masz, użyj strony „Znajdź zamówienie”.',
      action: { href: '/zamowienie', label: 'Znajdź zamówienie' },
    });
  }
  req.order = order;
  next();
}

function paymentView(order) {
  const p = order.payment;
  if (!p) return null;
  const asset = ASSETS[p.asset];
  const expected = BigInt(p.amount_atomic);
  const received = BigInt(p.received_atomic);
  const remaining = expected > received ? expected - received : 0n;
  const maxConf = p.txs && p.txs.length ? Math.min(...p.txs.map((t) => t.confirmations)) : 0;
  return {
    id: p.id,
    asset,
    status: p.status,
    address: p.address,
    amount: atomicToDecimal(expected, p.decimals),
    received: atomicToDecimal(received, p.decimals),
    remaining: atomicToDecimal(remaining, p.decimals),
    confirmations: Math.min(maxConf, p.required_confirmations),
    required: p.required_confirmations,
    expiresAt: parseDbDate(p.expires_at).toISOString(),
    expired: parseDbDate(p.expires_at) < new Date(),
    late: Boolean(p.late),
    overpaid: Boolean(p.overpaid),
    txs: (p.txs || []).map((t) => ({ txid: t.txid, url: asset.explorerTx + t.txid, amount: atomicToDecimal(t.amount_atomic, p.decimals), confirmations: t.confirmations })),
    sharedAddress: asset.kind !== 'utxo' && p.provider === 'direct',
  };
}

async function qrSvg(pv) {
  let text = pv.address;
  if (pv.asset.kind === 'utxo' && pv.asset.uri) text = `${pv.asset.uri}:${pv.address}?amount=${pv.remaining !== '0' ? pv.remaining : pv.amount}`;
  return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0d12', light: '#ffffff' } });
}

router.get('/zamowienie', (req, res) => {
  res.render('shop/find-order', { title: 'Znajdź zamówienie', sent: false });
});

router.post('/zamowienie', limits.checkout, (req, res) => {
  const pid = String(req.body.order || '').trim().toUpperCase();
  const mail = validate.email(req.body.email);
  const order = mail && /^NI-[A-Z0-9]{8}$/.test(pid) ? orders.byPublicId(pid) : null;
  if (order && order.email === mail) {
    // Unieważniamy stare linki; nowy token powstanie dopiero w chwili wysyłki e-maila
    db.get().prepare('DELETE FROM order_access_tokens WHERE order_id = ?').run(order.id);
    email.queue({
      to: order.email, kind: 'access_link', orderId: order.id,
      subject: `Link do zamówienia ${order.public_id}`,
      template: 'access-link',
      data: { orderId: order.id },
    });
    events.info('order', 'access_link_resent', `Wysłano nowy link do zamówienia ${order.public_id}`, { orderId: order.id }, { ip: req.ip });
  }
  // Ta sama odpowiedź niezależnie od wyniku — nie zdradzamy, czy zamówienie istnieje
  res.render('shop/find-order', { title: 'Znajdź zamówienie', sent: true });
});

router.get('/zamowienie/:pid', (req, res, next) => {
  if (!req.query.k) return next();
  const order = orders.byPublicId(req.params.pid);
  if (!orders.checkAccess(order, req.query.k)) {
    events.warn('security', 'order_bad_token', 'Nieprawidłowy link do zamówienia', null, { ip: req.ip });
    return res.status(403).render('shop/error', { title: 'Link jest nieprawidłowy', message: 'Ten link wygasł lub jest niepoprawny. Użyj najnowszej wiadomości e-mail albo strony „Znajdź zamówienie”.', action: { href: '/zamowienie', label: 'Znajdź zamówienie' } });
  }
  req.session.orders = { ...(req.session.orders || {}), [order.public_id]: Date.now() };
  // Usuwamy token z paska adresu i historii przeglądarki
  return res.redirect(`/zamowienie/${order.public_id}`);
});

router.get('/zamowienie/:pid', loadOrder, async (req, res, next) => {
  try {
    const order = orders.details(req.order.id);
    const pv = paymentView(order);
    const qr = pv && ['pending', 'underpaid'].includes(pv.status) && !pv.expired ? await qrSvg(pv) : null;
    const accessValid = order.delivery_access_until && parseDbDate(order.delivery_access_until) > new Date();
    res.render('shop/order', { title: `Zamówienie ${order.public_id}`, order, pv, qr, accessValid, revealed: null, claimed: req.query.zgloszono === '1' });
  } catch (e) { next(e); }
});

router.get('/zamowienie/:pid/status', limits.orderStatus, loadOrder, (req, res) => {
  const order = orders.details(req.order.id);
  const pv = paymentView(order);
  res.json({
    order: order.status,
    payment: pv && { status: pv.status, received: pv.received, remaining: pv.remaining, confirmations: pv.confirmations, required: pv.required, txCount: pv.txs.length },
  });
});

router.post('/zamowienie/:pid/odbierz', loadOrder, (req, res) => {
  const order = orders.details(req.order.id);
  if (order.status !== 'fulfilled') return res.redirect(`/zamowienie/${order.public_id}`);
  if (!order.delivery_access_until || parseDbDate(order.delivery_access_until) < new Date()) {
    req.flash('error', 'Czas na odbiór minął. Skontaktuj się z obsługą sklepu.');
    return res.redirect(`/zamowienie/${order.public_id}`);
  }
  const content = delivery.deliveredContent(order.id).map((c) => ({
    ...c,
    downloadToken: c.file ? crypto.signToken({ o: order.id, f: c.file.id }, 15 * 60) : null,
  }));
  events.info('order', 'delivery_revealed', `Klient wyświetlił produkty zamówienia ${order.public_id}`, { orderId: order.id }, { ip: req.ip });
  res.render('shop/order', { title: `Zamówienie ${order.public_id}`, order, pv: paymentView(order), qr: null, accessValid: true, revealed: content, claimed: false });
});

router.post('/zamowienie/:pid/zglos', limits.checkout, loadOrder, (req, res) => {
  const order = orders.details(req.order.id);
  if (!order.payment || order.payment.status === 'paid') return res.redirect(`/zamowienie/${order.public_id}`);
  const r = payments.claim(order.payment.id, req.body.txid);
  if (r.error) req.flash('error', r.error);
  res.redirect(`/zamowienie/${order.public_id}${r.error ? '' : '?zgloszono=1'}`);
});

router.get('/pobierz/:token', (req, res) => {
  const data = crypto.verifyToken(req.params.token);
  if (!data) return res.status(410).render('shop/error', { title: 'Link wygasł', message: 'Link do pobrania jest ważny 15 minut. Wróć na stronę zamówienia i kliknij „Odbierz produkty” ponownie.' });
  const order = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(data.o);
  const granted = order && req.session.orders && req.session.orders[order.public_id];
  const item = order && db.get().prepare('SELECT 1 FROM order_items WHERE order_id = ? AND delivery_file_id = ?').get(order.id, data.f);
  if (!granted || !item || order.status !== 'fulfilled') return res.status(403).render('shop/error', { title: 'Brak dostępu', message: 'Nie masz dostępu do tego pliku.' });
  const file = db.get().prepare('SELECT * FROM delivery_files WHERE id = ?').get(data.f);
  const full = file && path.join(config.privateDir, 'files', path.basename(file.stored_name));
  if (!file || !fs.existsSync(full)) return res.status(404).render('shop/error', { title: 'Plik niedostępny', message: 'Skontaktuj się z obsługą sklepu.' });
  events.info('order', 'file_downloaded', `Pobrano plik z zamówienia ${order.public_id}`, { orderId: order.id }, { ip: req.ip });
  res.set('X-Content-Type-Options', 'nosniff');
  res.download(full, file.original_name, { headers: { 'Content-Type': 'application/octet-stream' } });
});

module.exports = router;
