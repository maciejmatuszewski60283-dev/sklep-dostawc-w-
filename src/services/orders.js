'use strict';
const db = require('../db');
const settings = require('../lib/settings');
const events = require('../lib/events');
const crypto = require('../lib/crypto');
const { nowIso } = require('../lib/util');
const cart = require('./cart');
const payments = require('./payments');
const email = require('./email');
const access = require('./order-access');

const MIN_TOTAL_MINOR = 100;

/** Tworzy zamówienie z koszyka wraz z instrukcją płatności. Zwraca { order, accessToken } lub { error }. */
async function createFromCart(session, { email: customerEmail, assetCode, ip }) {
  const s = cart.summary(session);
  if (!s.items.length) return { error: 'Koszyk jest pusty.' };
  if (!s.valid) return { error: s.problems[0] || 'Niektóre produkty są niedostępne.' };
  if (s.discount.error) return { error: s.discount.error };
  if (s.total < MIN_TOTAL_MINOR) return { error: 'Minimalna wartość zamówienia to 1,00.' };

  const conn = db.get();
  const pendingLimit = settings.getInt('checkout.max_pending_per_email', 3);
  const pending = conn.prepare("SELECT COUNT(*) AS n FROM orders WHERE email = ? AND status = 'awaiting_payment' AND expires_at > datetime('now')").get(customerEmail).n;
  if (pending >= pendingLimit) return { error: 'Masz już nieopłacone zamówienia. Opłać je lub poczekaj, aż wygasną.' };

  const currency = settings.get('shop.currency');
  const publicId = crypto.publicOrderId();
  let prepared;
  try {
    prepared = await payments.prepare({ assetCode, fiatMinor: s.total, currency, orderPublicId: publicId });
  } catch (e) {
    events.warn('order', 'payment_prepare_failed', `Nie udało się przygotować płatności ${assetCode}: ${e.message}`);
    return { error: e.message.includes('niedostępn') || e.message.includes('Kurs') ? e.message : 'Nie udało się przygotować płatności. Spróbuj ponownie lub wybierz inną walutę.' };
  }

  const windowMin = settings.getInt('checkout.payment_window_minutes', 30);
  let orderId;
  try {
    orderId = conn.transaction(() => {
      // Ponowna kontrola dostępności wewnątrz transakcji (ochrona przed sprzedażą ponad stan)
      const fresh = cart.summary(session);
      if (!fresh.valid || fresh.total !== s.total) throw new Error('CART_CHANGED');
      const id = conn.prepare(`INSERT INTO orders (public_id, access_token_hash, email, status, currency, subtotal_minor, discount_minor, total_minor,
        discount_code_id, discount_code, ip_hash, terms_accepted_at, withdrawal_consent_at, expires_at)
        VALUES (?,?,?, 'awaiting_payment', ?,?,?,?,?,?,?, datetime('now'), datetime('now'), ?)`).run(
        publicId, crypto.sha256(crypto.randomToken(24)), customerEmail, currency, s.subtotal, s.discount.amount, s.total,
        s.discount.id || null, s.discount.code || null, ip ? crypto.hmac(ip).slice(0, 32) : null, nowIso(windowMin * 60 * 1000)
      ).lastInsertRowid;
      const ins = conn.prepare(`INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, delivery_type, delivery_file_id, unit_price_minor, quantity)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const it of s.items) {
        const v = it.variant;
        ins.run(id, v.product_id, v.id, v.product_name, v.name, v.delivery_type, v.delivery_file_id || null, v.price_minor, it.qty);
      }
      prepared.insert(id);
      return id;
    })();
  } catch (e) {
    prepared.release();
    if (e.message === 'CART_CHANGED') return { error: 'Zawartość lub dostępność koszyka zmieniła się. Sprawdź koszyk i spróbuj ponownie.' };
    throw e;
  }

  cart.clear(session);
  const order = conn.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  events.info('order', 'order_created', `Nowe zamówienie ${publicId} (${assetCode})`, { orderId });
  email.queue({
    to: customerEmail, kind: 'order_created', orderId,
    subject: `Zamówienie ${publicId} — instrukcja płatności`,
    template: 'order-created',
    data: { orderId },
    uniqueKey: `email:created:${orderId}`,
  });
  return { order };
}

function byPublicId(publicId) {
  return db.get().prepare('SELECT * FROM orders WHERE public_id = ?').get(String(publicId || '').toUpperCase());
}

function checkAccess(order, token) {
  return access.check(order, token);
}

function details(orderId) {
  const conn = db.get();
  const order = conn.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  order.items = conn.prepare(`SELECT oi.*, (SELECT thumb FROM product_images i WHERE i.product_id = oi.product_id ORDER BY sort, id LIMIT 1) AS thumb,
    p.slug AS product_slug FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`).all(orderId);
  order.payment = conn.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId) || null;
  if (order.payment) order.payment.txs = conn.prepare('SELECT * FROM payment_txs WHERE payment_id = ? ORDER BY id').all(order.payment.id);
  return order;
}

/** Nowy link dostępu do zamówienia (np. gdy klient zgubił e-mail) — tylko z panelu. */
function regenerateAccess(orderId) {
  return access.regenerate(orderId);
}

module.exports = { createFromCart, byPublicId, checkAccess, details, regenerateAccess, MIN_TOTAL_MINOR };
