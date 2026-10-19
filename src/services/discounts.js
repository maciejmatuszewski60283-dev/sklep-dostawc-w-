'use strict';
const db = require('../db');

function find(code) {
  return db.get().prepare('SELECT * FROM discount_codes WHERE code = ? COLLATE NOCASE').get(String(code || '').trim());
}

function usedCount(id) {
  return db.get().prepare(`SELECT COUNT(*) AS n FROM orders WHERE discount_code_id = ?
    AND (status IN ('paid','awaiting_stock','fulfilled','underpaid') OR (status = 'awaiting_payment' AND expires_at > datetime('now')))`).get(id).n;
}

/** Sprawdza kod i oblicza rabat (w jednostkach podstawowych waluty). */
function evaluate(code, subtotal) {
  const d = find(code);
  const fail = (error) => ({ amount: 0, code: null, error });
  if (!d || !d.active) return fail('Nieprawidłowy kod rabatowy.');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (d.starts_at && d.starts_at > now) return fail('Ten kod nie jest jeszcze aktywny.');
  if (d.expires_at && d.expires_at < now) return fail('Ten kod wygasł.');
  if (d.max_uses != null && usedCount(d.id) >= d.max_uses) return fail('Limit użyć tego kodu został wyczerpany.');
  if (subtotal < d.min_order_minor) return fail('Wartość koszyka jest za niska dla tego kodu.');
  let amount = d.type === 'percent' ? Math.floor((subtotal * Math.min(100, d.value)) / 100) : d.value;
  amount = Math.min(amount, subtotal);
  return { amount, code: d.code, id: d.id, error: null, discount: d };
}

module.exports = { find, evaluate, usedCount };
