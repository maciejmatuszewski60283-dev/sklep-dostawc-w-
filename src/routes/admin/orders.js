'use strict';
const express = require('express');
const db = require('../../db');
const config = require('../../config');
const { permit } = require('../../middleware/admin');
const orders = require('../../services/orders');
const delivery = require('../../services/delivery');
const payments = require('../../services/payments');
const email = require('../../services/email');
const { ASSETS } = require('../../services/payments/assets');
const { atomicToDecimal } = require('../../lib/money');
const { int, str, escapeLike, nowIso } = require('../../lib/util');

const router = express.Router();
const A = () => config.adminPath;

const STATUS_LABELS = {
  awaiting_payment: 'Oczekuje na płatność', underpaid: 'Niedopłacone', paid: 'Opłacone', awaiting_stock: 'Czeka na towar',
  fulfilled: 'Zrealizowane', expired: 'Wygasłe', cancelled: 'Anulowane', refunded: 'Zwrócone',
};

router.use((req, res, next) => {
  res.locals.STATUS_LABELS = STATUS_LABELS;
  res.locals.ASSETS = ASSETS;
  res.locals.atomicToDecimal = atomicToDecimal;
  next();
});

// ---------------------------------------------------------------------------
// Zamówienia
// ---------------------------------------------------------------------------

router.get('/zamowienia', permit('orders'), (req, res) => {
  const q = str(req.query.q, 120);
  const status = str(req.query.status, 30);
  const asset = str(req.query.waluta, 30);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.od || '') ? req.query.od : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.do || '') ? req.query.do : '';
  const page = Math.max(1, int(req.query.strona, 1));
  const where = ['1=1'];
  const params = [];
  if (q) {
    where.push("(o.public_id LIKE ? ESCAPE '\\' OR o.email LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM payments p2 JOIN payment_txs t ON t.payment_id = p2.id WHERE p2.order_id = o.id AND t.txid LIKE ? ESCAPE '\\') OR EXISTS (SELECT 1 FROM payments p3 WHERE p3.order_id = o.id AND p3.address = ?))");
    const like = `%${escapeLike(q)}%`;
    params.push(like, like, like, q);
  }
  if (STATUS_LABELS[status]) { where.push('o.status = ?'); params.push(status); }
  if (ASSETS[asset]) { where.push('EXISTS (SELECT 1 FROM payments p4 WHERE p4.order_id = o.id AND p4.asset = ?)'); params.push(asset); }
  if (from) { where.push('o.created_at >= ?'); params.push(from); }
  if (to) { where.push("o.created_at < date(?, '+1 day')"); params.push(to); }
  const conn = db.get();
  const total = conn.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where.join(' AND ')}`).get(...params).n;
  const rows = conn.prepare(`SELECT o.*, (SELECT asset FROM payments p WHERE p.order_id = o.id ORDER BY id DESC LIMIT 1) AS asset,
      (SELECT GROUP_CONCAT(product_name, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS products
    FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 50 OFFSET ?`).all(...params, (page - 1) * 50);
  res.render('admin/orders', { title: 'Zamówienia', rows, total, page, pages: Math.max(1, Math.ceil(total / 50)), filters: { q, status, asset, from, to } });
});

router.get('/zamowienia/:id', permit('orders'), (req, res, next) => {
  const order = orders.details(int(req.params.id));
  if (!order) return next();
  const conn = db.get();
  const emails = conn.prepare('SELECT * FROM emails WHERE order_id = ? ORDER BY id DESC').all(order.id);
  const deliveries = conn.prepare("SELECT * FROM deliveries WHERE order_id = ? AND detail != 'stock_decremented' ORDER BY id DESC").all(order.id);
  const evts = conn.prepare("SELECT * FROM events WHERE json_extract(meta, '$.orderId') = ? OR (json_extract(meta, '$.paymentId') = ? AND ? IS NOT NULL) ORDER BY id DESC LIMIT 50")
    .all(order.id, order.payment ? order.payment.id : -1, order.payment ? 1 : null);
  const claims = order.payment ? conn.prepare('SELECT * FROM payment_claims WHERE payment_id = ? ORDER BY id DESC').all(order.payment.id) : [];
  const stockCounts = order.items.map((it) => (it.delivery_type === 'keys'
    ? conn.prepare('SELECT COUNT(*) AS n FROM stock_items WHERE order_item_id = ?').get(it.id).n : null));
  res.render('admin/order', { title: `Zamówienie ${order.public_id}`, order, emails, deliveries, evts, claims, stockCounts, newLink: req.session.newOrderLink || null });
  delete req.session.newOrderLink;
});

function loadOrder(req, res, next) {
  req.order = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(int(req.params.id));
  if (!req.order) return next('route');
  next();
}

const back = (req) => `${A()}/zamowienia/${req.order.id}`;

router.post('/zamowienia/:id/realizuj', permit('orders.manage'), loadOrder, (req, res) => {
  const r = delivery.fulfill(req.order.id);
  res.locals.audit('order_fulfill_retry', `Ręcznie ponowiono realizację ${req.order.public_id}: ${r}`, { orderId: req.order.id });
  req.flash(r === 'fulfilled' ? 'success' : 'error', r === 'fulfilled' ? 'Zamówienie zrealizowane.' : r === 'awaiting_stock' ? 'Nadal brakuje towaru — uzupełnij magazyn.' : 'To zamówienie nie wymaga realizacji.');
  res.redirect(back(req));
});

router.post('/zamowienia/:id/reczna-dostawa', permit('orders.manage'), loadOrder, (req, res) => {
  const item = db.get().prepare("SELECT * FROM order_items WHERE id = ? AND order_id = ? AND delivery_type = 'manual'").get(int(req.body.item_id), req.order.id);
  const content = str(req.body.content, 5000);
  if (!item || !content) {
    req.flash('error', 'Wpisz treść, którą otrzyma klient.');
    return res.redirect(back(req));
  }
  delivery.setManualDelivery(item.id, content);
  res.locals.audit('manual_delivery', `Wprowadzono ręczną dostawę dla ${req.order.public_id}`, { orderId: req.order.id });
  const r = delivery.fulfill(req.order.id);
  req.flash('success', r === 'fulfilled' ? 'Zapisano i zrealizowano zamówienie — klient dostał e-mail.' : 'Zapisano treść. Zamówienie zostanie zrealizowane, gdy wszystkie pozycje będą gotowe.');
  res.redirect(back(req));
});

router.post('/zamowienia/:id/wyslij-ponownie', permit('orders'), loadOrder, (req, res) => {
  const o = req.order;
  if (o.status !== 'fulfilled') {
    req.flash('error', 'E-mail z produktami można wysłać tylko dla zrealizowanego zamówienia.');
    return res.redirect(back(req));
  }
  email.queue({
    to: o.email, kind: 'delivery', orderId: o.id, subject: `Zamówienie ${o.public_id} — odbierz produkty`,
    template: 'order-delivered', data: { orderId: o.id }, uniqueKey: `email:delivered:${o.id}:resend:${Date.now()}`,
  });
  res.locals.audit('email_resent', `Ponownie wysłano e-mail z produktami (${o.public_id})`, { orderId: o.id });
  req.flash('success', 'E-mail dodany do kolejki wysyłki.');
  res.redirect(back(req));
});

router.post('/zamowienia/:id/nowy-link', permit('orders'), loadOrder, (req, res) => {
  if (req.body.send === '1') {
    db.get().prepare('DELETE FROM order_access_tokens WHERE order_id = ?').run(req.order.id);
    email.queue({
      to: req.order.email, kind: 'access_link', orderId: req.order.id, subject: `Link do zamówienia ${req.order.public_id}`,
      template: 'access-link', data: { orderId: req.order.id },
    });
    req.flash('success', 'Wygenerowano nowy link i wysłano go klientowi. Poprzedni link przestał działać.');
  } else {
    const token = orders.regenerateAccess(req.order.id);
    req.session.newOrderLink = `${config.publicUrl}/zamowienie/${req.order.public_id}?k=${token}`;
    req.flash('success', 'Wygenerowano nowy link (poprzedni przestał działać).');
  }
  res.locals.audit('order_link_regenerated', `Nowy link dostępu do ${req.order.public_id}`, { orderId: req.order.id });
  res.redirect(back(req));
});

router.post('/zamowienia/:id/przedluz', permit('orders'), loadOrder, (req, res) => {
  const days = Math.min(365, Math.max(1, int(req.body.days, 7)));
  db.get().prepare('UPDATE orders SET delivery_access_until = ? WHERE id = ?').run(nowIso(days * 86400000), req.order.id);
  res.locals.audit('order_access_extended', `Przedłużono dostęp do ${req.order.public_id} o ${days} dni`, { orderId: req.order.id });
  req.flash('success', `Dostęp przedłużony o ${days} dni.`);
  res.redirect(back(req));
});

router.post('/zamowienia/:id/anuluj', permit('orders.manage'), loadOrder, (req, res) => {
  const r = db.get().prepare("UPDATE orders SET status='cancelled' WHERE id = ? AND status IN ('awaiting_payment','expired','underpaid')").run(req.order.id);
  if (r.changes) {
    db.get().prepare("UPDATE payments SET status='failed' WHERE order_id = ? AND status IN ('pending','underpaid')").run(req.order.id);
    res.locals.audit('order_cancelled', `Anulowano zamówienie ${req.order.public_id}`, { orderId: req.order.id });
    req.flash('success', 'Zamówienie anulowane.');
  } else req.flash('error', 'Nie można anulować opłaconego lub zrealizowanego zamówienia — użyj zwrotu.');
  res.redirect(back(req));
});

router.post('/zamowienia/:id/zwrot', permit('orders.manage'), loadOrder, (req, res) => {
  const tx = str(req.body.refund_tx, 120);
  const note = str(req.body.refund_note, 1000);
  if (!tx && !note) {
    req.flash('error', 'Podaj identyfikator transakcji zwrotu lub notatkę.');
    return res.redirect(back(req));
  }
  const conn = db.get();
  conn.transaction(() => {
    conn.prepare("UPDATE orders SET status='refunded', refund_tx=?, refund_note=? WHERE id=?").run(tx || null, note || null, req.order.id);
    conn.prepare("UPDATE payments SET status='refunded' WHERE order_id=?").run(req.order.id);
    if (req.body.restock === '1') {
      // Klucze wracają do magazynu tylko jeśli klient ich nie widział
      const revealed = conn.prepare("SELECT 1 FROM events WHERE type IN ('delivery_revealed','file_downloaded') AND json_extract(meta,'$.orderId') = ?").get(req.order.id);
      if (!revealed) {
        conn.prepare("UPDATE stock_items SET status='available', order_item_id=NULL, sold_at=NULL WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)").run(req.order.id);
      }
    }
  })();
  res.locals.audit('order_refunded', `Oznaczono zwrot zamówienia ${req.order.public_id}`, { orderId: req.order.id, txid: tx });
  req.flash('success', 'Zamówienie oznaczone jako zwrócone.');
  res.redirect(back(req));
});

router.post('/zamowienia/:id/notatka', permit('orders'), loadOrder, (req, res) => {
  db.get().prepare('UPDATE orders SET admin_note = ? WHERE id = ?').run(str(req.body.admin_note, 5000), req.order.id);
  req.flash('success', 'Zapisano notatkę.');
  res.redirect(back(req));
});

// ---------------------------------------------------------------------------
// Płatności wymagające uwagi: nieprzypisane wpływy i zgłoszenia klientów
// ---------------------------------------------------------------------------

router.get('/platnosci', permit('payments.view'), (req, res) => {
  const conn = db.get();
  const unmatched = conn.prepare('SELECT * FROM unmatched_transfers ORDER BY assigned_payment_id IS NOT NULL, id DESC LIMIT 200').all();
  const claims = conn.prepare(`SELECT c.*, p.asset, p.amount_atomic, p.decimals, p.status AS payment_status, p.order_id, o.public_id
    FROM payment_claims c JOIN payments p ON p.id = c.payment_id JOIN orders o ON o.id = p.order_id ORDER BY c.status = 'open' DESC, c.id DESC LIMIT 200`).all();
  const recent = conn.prepare(`SELECT p.*, o.public_id FROM payments p JOIN orders o ON o.id = p.order_id ORDER BY p.id DESC LIMIT 50`).all();
  const open = conn.prepare(`SELECT p.id, p.asset, p.amount_atomic, p.decimals, p.status, o.public_id, o.created_at FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.provider = 'direct' AND p.status IN ('pending','underpaid','expired') AND p.created_at > datetime('now','-14 days') ORDER BY p.id DESC LIMIT 200`).all();
  res.render('admin/payments', { title: 'Płatności', unmatched, claims, recent, open });
});

router.post('/platnosci/przypisz', permit('orders.manage'), async (req, res) => {
  try {
    await payments.assignUnmatched(int(req.body.unmatched_id), int(req.body.payment_id), { ip: req.ip, adminUserId: req.admin.id });
    req.flash('success', 'Wpływ przypisany. Status płatności zostanie zaktualizowany po weryfikacji w sieci.');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`${A()}/platnosci`);
});

router.post('/platnosci/zgloszenie/:id/odrzuc', permit('orders.manage'), (req, res) => {
  db.get().prepare("UPDATE payment_claims SET status='rejected' WHERE id = ?").run(int(req.params.id));
  res.locals.audit('claim_rejected', 'Odrzucono zgłoszenie płatności', { claimId: int(req.params.id) });
  res.redirect(`${A()}/platnosci`);
});

// ---------------------------------------------------------------------------
// Dostawy i e-maile
// ---------------------------------------------------------------------------

router.get('/dostawy', permit('deliveries'), (req, res) => {
  const conn = db.get();
  const status = str(req.query.status, 20);
  const emails = conn.prepare(`SELECT e.*, o.public_id FROM emails e LEFT JOIN orders o ON o.id = e.order_id
    ${['sent', 'failed', 'queued'].includes(status) ? 'WHERE e.status = ?' : ''} ORDER BY e.id DESC LIMIT 200`).all(...(['sent', 'failed', 'queued'].includes(status) ? [status] : []));
  const deliveries = conn.prepare(`SELECT d.*, o.public_id FROM deliveries d JOIN orders o ON o.id = d.order_id
    WHERE d.detail != 'stock_decremented' ORDER BY d.id DESC LIMIT 200`).all();
  res.render('admin/deliveries', { title: 'Dostawy i e-maile', emails, deliveries, status });
});

router.post('/dostawy/email/:id/ponow', permit('deliveries'), (req, res) => {
  email.retryEmail(int(req.params.id));
  res.locals.audit('email_retry', 'Ponowiono wysyłkę e-maila', { emailId: int(req.params.id) });
  req.flash('success', 'E-mail wróci do kolejki wysyłki w ciągu kilku sekund.');
  res.redirect(req.body.back === 'order' && req.body.order_id ? `${A()}/zamowienia/${int(req.body.order_id)}` : `${A()}/dostawy`);
});

module.exports = router;
