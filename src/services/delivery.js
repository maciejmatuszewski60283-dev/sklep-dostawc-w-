'use strict';
// Automatyczna realizacja opłaconych zamówień: przypisanie kluczy z magazynu / pliku, e-mail do klienta.
const db = require('../db');
const settings = require('../lib/settings');
const events = require('../lib/events');
const { encrypt, decrypt, sha256 } = require('../lib/crypto');
const { nowIso } = require('../lib/util');
const jobs = require('./jobs');
const email = require('./email');

/**
 * Realizuje zamówienie. Idempotentne: ponowne wywołanie nie przypisze drugiego klucza ani nie wyśle drugiego e-maila.
 * Zwraca 'fulfilled' | 'awaiting_stock' | 'skipped'.
 */
function fulfill(orderId) {
  const conn = db.get();
  const result = conn.transaction(() => {
    const order = conn.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || !['paid', 'awaiting_stock'].includes(order.status)) return { status: 'skipped' };
    const items = conn.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const missing = [];
    for (const it of items) {
      if (it.delivery_type === 'keys') {
        const have = conn.prepare('SELECT COUNT(*) AS n FROM stock_items WHERE order_item_id = ?').get(it.id).n;
        const need = it.quantity - have;
        if (need > 0) {
          const free = conn.prepare("SELECT id FROM stock_items WHERE variant_id = ? AND status = 'available' ORDER BY id LIMIT ?").all(it.variant_id, need);
          const assign = conn.prepare("UPDATE stock_items SET status='sold', order_item_id=?, sold_at=datetime('now') WHERE id=? AND status='available'");
          let got = 0;
          for (const f of free) got += assign.run(it.id, f.id).changes;
          if (got < need) missing.push(`${it.product_name} — ${it.variant_name}: brakuje ${need - got} szt.`);
        }
      } else if (it.delivery_type === 'file') {
        if (!it.delivery_file_id) missing.push(`${it.product_name}: brak pliku do wysłania`);
      } else if (it.delivery_type === 'manual') {
        if (!it.manual_delivery_enc) missing.push(`${it.product_name}: wymaga ręcznej realizacji`);
      }
      // Stan ręczny (pliki / realizacja ręczna) zmniejszamy jednorazowo — przy pierwszej próbie realizacji
      if (order.status === 'paid' && it.delivery_type !== 'keys' && it.variant_id) {
        conn.prepare('UPDATE variants SET manual_stock = MAX(0, manual_stock - ?) WHERE id = ? AND manual_stock IS NOT NULL').run(it.quantity, it.variant_id);
      }
    }
    if (missing.length) {
      const changed = conn.prepare("UPDATE orders SET status='awaiting_stock' WHERE id=? AND status='paid'").run(orderId).changes;
      conn.prepare("INSERT INTO deliveries (order_id, status, detail) VALUES (?, ?, ?)").run(orderId,
        items.every((i) => i.delivery_type === 'manual') ? 'manual_pending' : 'awaiting_stock', missing.join('\n'));
      return { status: 'awaiting_stock', order, missing, firstTime: changed > 0 };
    }
    const days = settings.getInt('delivery.access_days', 30);
    conn.prepare("UPDATE order_items SET delivered_at = COALESCE(delivered_at, datetime('now')) WHERE order_id = ?").run(orderId);
    conn.prepare("UPDATE orders SET status='fulfilled', fulfilled_at=datetime('now'), delivery_access_until=? WHERE id=?").run(nowIso(days * 86400 * 1000), orderId);
    conn.prepare("INSERT INTO deliveries (order_id, status, detail) VALUES (?, 'delivered', 'Produkty przypisane automatycznie')").run(orderId);
    return { status: 'fulfilled', order };
  })();

  if (result.status === 'fulfilled') {
    events.info('order', 'order_fulfilled', `Zamówienie ${result.order.public_id} zrealizowane`, { orderId });
    email.queue({
      to: result.order.email, kind: 'delivery', orderId,
      subject: `Zamówienie ${result.order.public_id} opłacone — odbierz produkty`,
      template: 'order-delivered', data: { orderId },
      uniqueKey: `email:delivered:${orderId}`,
    });
  } else if (result.status === 'awaiting_stock') {
    events.warn('order', 'order_awaiting_stock', `Zamówienie ${result.order.public_id} opłacone, ale brakuje towaru`, { orderId, missing: result.missing.join('; ') });
    if (result.firstTime) {
      email.queue({
        to: result.order.email, kind: 'paid_waiting', orderId,
        subject: `Zamówienie ${result.order.public_id} opłacone — przygotowujemy realizację`,
        template: 'order-paid-waiting', data: { orderId },
        uniqueKey: `email:paidwaiting:${orderId}`,
      });
      if (settings.getBool('notify.on_out_of_stock')) {
        email.notifyAdmin('Opłacone zamówienie czeka na towar', `Zamówienie ${result.order.public_id} jest opłacone, ale nie można go zrealizować:\n${result.missing.join('\n')}\n\nUzupełnij magazyn — zamówienie zostanie zrealizowane automatycznie.`);
      }
    }
  }
  return result.status;
}

/** Po dodaniu towaru: spróbuj zrealizować oczekujące zamówienia z tym wariantem. */
function retryAwaitingForVariant(variantId) {
  const rows = db.get().prepare(`SELECT DISTINCT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'awaiting_stock' AND oi.variant_id = ? ORDER BY o.paid_at`).all(variantId);
  for (const r of rows) fulfill(r.id);
  return rows.length;
}

/** Ręczna realizacja (produkty typu "manual"): administrator wpisuje treść dla klienta. */
function setManualDelivery(orderItemId, content) {
  db.get().prepare('UPDATE order_items SET manual_delivery_enc = ? WHERE id = ?').run(encrypt(content), orderItemId);
}

/** Zawartość do wyświetlenia klientowi (tylko dla zrealizowanego zamówienia). */
function deliveredContent(orderId) {
  const conn = db.get();
  const items = conn.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  return items.map((it) => {
    const out = { item: it, keys: [], file: null, manual: null };
    if (it.delivery_type === 'keys') {
      out.keys = conn.prepare('SELECT content_enc FROM stock_items WHERE order_item_id = ? ORDER BY id').all(it.id).map((r) => decrypt(r.content_enc));
    } else if (it.delivery_type === 'file' && it.delivery_file_id) {
      out.file = conn.prepare('SELECT id, original_name, size FROM delivery_files WHERE id = ?').get(it.delivery_file_id);
    } else if (it.delivery_type === 'manual' && it.manual_delivery_enc) {
      out.manual = decrypt(it.manual_delivery_enc);
    }
    return out;
  });
}

/** Dodaje klucze do magazynu wariantu (jeden na linię). Duplikaty są pomijane. */
function addStock(variantId, text) {
  const conn = db.get();
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let added = 0;
  let duplicates = 0;
  conn.transaction(() => {
    const ins = conn.prepare('INSERT OR IGNORE INTO stock_items (variant_id, content_enc, content_hash) VALUES (?,?,?)');
    for (const l of lines) {
      if (l.length > 2000) continue;
      const r = ins.run(variantId, encrypt(l), sha256(`${variantId}:${l}`));
      if (r.changes) added++; else duplicates++;
    }
  })();
  return { added, duplicates, total: lines.length };
}

jobs.register('fulfill_order', ({ orderId }) => { fulfill(orderId); });

jobs.register('notify_paid', ({ orderId }) => {
  if (!settings.getBool('notify.on_paid')) return;
  const o = db.get().prepare('SELECT public_id, total_minor, currency FROM orders WHERE id = ?').get(orderId);
  if (o) email.notifyAdmin(`Nowe opłacone zamówienie ${o.public_id}`, `Zamówienie ${o.public_id} na kwotę ${(o.total_minor / 100).toFixed(2)} ${o.currency} zostało opłacone.`);
});

jobs.register('notify_admin', ({ subject, message }) => { email.notifyAdmin(subject, message); });

module.exports = { fulfill, retryAwaitingForVariant, setManualDelivery, deliveredContent, addStock };
