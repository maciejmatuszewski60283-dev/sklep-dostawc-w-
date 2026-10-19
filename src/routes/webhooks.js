'use strict';
const express = require('express');
const db = require('../db');
const events = require('../lib/events');
const nowpayments = require('../services/payments/nowpayments');
const payments = require('../services/payments');

const router = express.Router();

// NOWPayments IPN. Podpis sprawdzamy kluczem IPN, a następnie POBIERAMY STATUS Z API
// (nie ufamy samej treści webhooka). Każde zdarzenie przetwarzamy tylko raz.
router.post('/nowpayments', async (req, res) => {
  const body = req.body;
  if (!nowpayments.verifySignature(body, req.get('x-nowpayments-sig'))) {
    events.warn('security', 'webhook_bad_signature', 'Odrzucono webhook NOWPayments z nieprawidłowym podpisem', null, { ip: req.ip });
    return res.status(401).json({ error: 'invalid signature' });
  }
  const conn = db.get();
  const p = conn.prepare("SELECT * FROM payments WHERE provider = 'nowpayments' AND provider_payment_id = ?").get(String(body.payment_id));
  if (!p) {
    conn.prepare('INSERT OR IGNORE INTO webhook_events (provider, event_key, payload, result) VALUES (?,?,?,?)')
      .run('nowpayments', `unknown:${body.payment_id}:${body.payment_status}`, JSON.stringify(body).slice(0, 8000), 'unknown_payment');
    return res.json({ ok: true });
  }
  let fresh;
  try {
    fresh = await nowpayments.getPayment(p.provider_payment_id);
  } catch (e) {
    events.warn('payment', 'webhook_processing_failed', `Nie udało się pobrać statusu z NOWPayments: ${e.message}`, { paymentId: p.id });
    return res.status(503).json({ error: 'retry later' }); // procesor ponowi webhook
  }
  // Deduplikacja po stanie potwierdzonym przez API (a nie po treści webhooka)
  const key = `${fresh.payment_id}:${fresh.payment_status}:${fresh.actually_paid}`;
  const ins = conn.prepare('INSERT OR IGNORE INTO webhook_events (provider, event_key, payload) VALUES (?,?,?)').run('nowpayments', key, JSON.stringify(body).slice(0, 8000));
  if (!ins.changes) return res.json({ ok: true, duplicate: true });
  const result = payments.applyNowpayments(p, fresh);
  conn.prepare('UPDATE webhook_events SET result = ? WHERE provider = ? AND event_key = ?').run(result, 'nowpayments', key);
  return res.json({ ok: true });
});

module.exports = router;
