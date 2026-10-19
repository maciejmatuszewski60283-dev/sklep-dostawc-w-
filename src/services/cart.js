'use strict';
// Koszyk przechowywany w sesji (po stronie serwera). Ceny i dostępność są zawsze liczone na nowo z bazy.
const catalog = require('./catalog');
const discounts = require('./discounts');

const MAX_LINES = 20;
const MAX_QTY = 10;

function lines(session) {
  return Array.isArray(session.cart) ? session.cart : [];
}

function add(session, variantId, qty = 1) {
  const v = catalog.sellableVariant(variantId);
  if (!v) return { error: 'Ten produkt jest niedostępny.' };
  const cart = lines(session).slice();
  const existing = cart.find((l) => l.variantId === v.id);
  const want = Math.min(MAX_QTY, (existing ? existing.qty : 0) + Math.max(1, qty));
  if (v.available < want) return { error: v.available > 0 ? `Dostępnych sztuk: ${v.available}.` : 'Produkt chwilowo niedostępny.' };
  if (existing) existing.qty = want;
  else {
    if (cart.length >= MAX_LINES) return { error: 'Koszyk jest pełny.' };
    cart.push({ variantId: v.id, qty: want });
  }
  session.cart = cart;
  return { ok: true, variant: v };
}

function update(session, variantId, qty) {
  let cart = lines(session).slice();
  if (qty <= 0) cart = cart.filter((l) => l.variantId !== variantId);
  else {
    const l = cart.find((x) => x.variantId === variantId);
    if (l) l.qty = Math.min(MAX_QTY, qty);
  }
  session.cart = cart;
}

function clear(session) {
  delete session.cart;
  delete session.discountCode;
}

/** Pełne podsumowanie koszyka z aktualnymi cenami, dostępnością i rabatem. */
function summary(session) {
  const items = [];
  const problems = [];
  for (const l of lines(session)) {
    const v = catalog.sellableVariant(l.variantId);
    if (!v) { problems.push('Jeden z produktów został wycofany i usunęliśmy go z koszyka.'); continue; }
    const qty = Math.min(l.qty, MAX_QTY);
    if (v.available < qty) problems.push(`„${v.product_name}”: dostępnych sztuk ${v.available}.`);
    items.push({ variant: v, qty, lineTotal: v.price_minor * qty, ok: v.available >= qty });
  }
  const subtotal = items.reduce((a, i) => a + i.lineTotal, 0);
  let discount = { amount: 0, code: null, error: null };
  if (session.discountCode && items.length) discount = discounts.evaluate(session.discountCode, subtotal);
  const total = Math.max(0, subtotal - discount.amount);
  return { items, subtotal, discount, total, problems, count: items.reduce((a, i) => a + i.qty, 0), valid: items.length > 0 && items.every((i) => i.ok) };
}

function count(session) {
  return lines(session).reduce((a, l) => a + l.qty, 0);
}

module.exports = { add, update, clear, summary, count, MAX_QTY };
