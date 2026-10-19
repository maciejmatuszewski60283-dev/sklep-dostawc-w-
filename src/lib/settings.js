'use strict';
// Ustawienia sklepu edytowalne z panelu administratora (bez zmian w kodzie).
// Wartości oznaczone jako sekretne są szyfrowane w bazie i nigdy nie trafiają do przeglądarki.
const db = require('../db');
const { encrypt, decrypt } = require('./crypto');

const DEFAULTS = {
  'shop.name': 'najtańsze itemki',
  'shop.tagline': 'Produkty cyfrowe w najniższych cenach. Płatność kryptowalutami, dostawa automatycznie.',
  'shop.currency': 'PLN',
  'shop.contact_email': '',
  'shop.support_hours': '',
  'shop.announcement': '',
  'home.hero_title': 'Najtańsze itemki.\nBez czekania.',
  'home.hero_subtitle': 'Kody, klucze i produkty cyfrowe. Płacisz w krypto, odbierasz automatycznie po potwierdzeniu transakcji.',
  'checkout.payment_window_minutes': '30',
  'checkout.late_grace_hours': '24',
  'checkout.max_pending_per_email': '3',
  'delivery.access_days': '30',
  'stock.low_threshold': '5',
  'email.from_name': 'najtańsze itemki',
  'email.from_address': '',
  'email.smtp_host': '',
  'email.smtp_port': '587',
  'email.smtp_secure': '0',
  'email.smtp_user': '',
  'email.smtp_pass': '',
  'notify.admin_email': '',
  'notify.on_paid': '1',
  'notify.on_out_of_stock': '1',
  'notify.on_delivery_failed': '1',
  'payments.nowpayments.api_key': '',
  'payments.nowpayments.ipn_secret': '',
  'payments.nowpayments.sandbox': '0',
  'payments.etherscan_api_key': '',
  'payments.trongrid_api_key': '',
};

const SECRET_KEYS = new Set([
  'email.smtp_pass',
  'payments.nowpayments.api_key',
  'payments.nowpayments.ipn_secret',
  'payments.etherscan_api_key',
  'payments.trongrid_api_key',
]);

let cache = null;

function load() {
  const rows = db.get().prepare('SELECT key, value, is_secret FROM settings').all();
  cache = new Map();
  for (const r of rows) {
    let v = r.value;
    if (r.is_secret && v) {
      try { v = decrypt(v); } catch { v = ''; }
    }
    cache.set(r.key, v);
  }
}

function get(key) {
  if (!cache) load();
  if (cache.has(key)) return cache.get(key);
  return DEFAULTS[key] ?? '';
}

function getInt(key, def = 0) {
  const n = parseInt(get(key), 10);
  return Number.isFinite(n) ? n : def;
}

function getBool(key) {
  return get(key) === '1';
}

function getJson(key, def = null) {
  try {
    const v = get(key);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
}

function set(key, value) {
  const secret = SECRET_KEYS.has(key) || key.startsWith('secret.');
  const v = value == null ? '' : String(value);
  db.get().prepare(
    `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at`
  ).run(key, secret && v ? encrypt(v) : v, secret ? 1 : 0);
  cache = null;
}

function setJson(key, obj) {
  set(key, JSON.stringify(obj));
}

function isSecretSet(key) {
  return Boolean(get(key));
}

function invalidate() {
  cache = null;
}

/** Ustawienia bezpieczne do pokazania na publicznych stronach. */
function publicView() {
  return {
    name: get('shop.name'),
    tagline: get('shop.tagline'),
    currency: get('shop.currency'),
    contactEmail: get('shop.contact_email'),
    supportHours: get('shop.support_hours'),
    announcement: get('shop.announcement'),
    heroTitle: get('home.hero_title'),
    heroSubtitle: get('home.hero_subtitle'),
  };
}

module.exports = { DEFAULTS, SECRET_KEYS, get, getInt, getBool, getJson, set, setJson, isSecretSet, invalidate, publicView };
