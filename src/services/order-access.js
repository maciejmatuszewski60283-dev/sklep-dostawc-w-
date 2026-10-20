'use strict';
// Tokeny dostępu do strony zamówienia (link z e-maila). W bazie przechowujemy wyłącznie skrót SHA-256.
const db = require('../db');
const config = require('../config');
const { randomToken, sha256 } = require('../lib/crypto');
const { nowIso } = require('../lib/util');

const TTL_DAYS = 180;

function issue(orderId) {
  const token = randomToken(24);
  db.get().prepare('INSERT INTO order_access_tokens (order_id, token_hash, expires_at) VALUES (?,?,?)')
    .run(orderId, sha256(token), nowIso(TTL_DAYS * 86400 * 1000));
  return token;
}

function url(order) {
  return `${config.publicUrl}/zamowienie/${order.public_id}?k=${issue(order.id)}`;
}

function check(order, token) {
  if (!order || !token || String(token).length > 100) return false;
  return Boolean(db.get().prepare("SELECT 1 FROM order_access_tokens WHERE order_id = ? AND token_hash = ? AND expires_at > datetime('now')")
    .get(order.id, sha256(String(token))));
}

/** Unieważnia wszystkie dotychczasowe linki i wydaje nowy. */
function regenerate(orderId) {
  db.get().prepare('DELETE FROM order_access_tokens WHERE order_id = ?').run(orderId);
  return issue(orderId);
}

module.exports = { issue, url, check, regenerate };
