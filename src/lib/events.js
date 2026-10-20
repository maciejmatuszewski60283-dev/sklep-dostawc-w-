'use strict';
// Dziennik zdarzeń (bezpieczeństwo, płatności, zamówienia, system).
// UWAGA: nigdy nie zapisuj tu kluczy produktów, haseł, tokenów ani pełnych sekretów.
const db = require('../db');
const config = require('../config');

const SENSITIVE = /(password|haslo|secret|token|key|content|totp|code)/i;

function scrub(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE.test(k) && !/^(order|payment|txid|asset|variant|product|stock)/i.test(k)) out[k] = '[ukryte]';
    else out[k] = v;
  }
  return out;
}

function log(level, category, type, message, meta = null, ctx = {}) {
  try {
    db.get().prepare(
      'INSERT INTO events (level, category, type, message, meta, ip, admin_user_id) VALUES (?,?,?,?,?,?,?)'
    ).run(level, category, type, String(message).slice(0, 1000), meta ? JSON.stringify(scrub(meta)) : null,
      ctx.ip || null, ctx.adminUserId || null);
  } catch (e) {
    console.error('[events] nie udało się zapisać zdarzenia', e.message);
  }
  if (!config.isTest || process.env.LOG_EVENTS) {
    const line = `[${level}] ${category}/${type}: ${message}`;
    if (level === 'error') console.error(line);
    else if (!config.isTest) console.log(line);
  }
}

module.exports = {
  info: (c, t, m, meta, ctx) => log('info', c, t, m, meta, ctx),
  warn: (c, t, m, meta, ctx) => log('warn', c, t, m, meta, ctx),
  error: (c, t, m, meta, ctx) => log('error', c, t, m, meta, ctx),
  fromReq: (req) => ({ ip: req.ip, adminUserId: req.admin ? req.admin.id : null }),
};
