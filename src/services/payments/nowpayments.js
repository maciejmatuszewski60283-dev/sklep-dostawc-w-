'use strict';
// Integracja z zewnętrznym procesorem NOWPayments (opcjonalna alternatywa dla własnej bramki).
// Dokumentacja: https://documenter.getpostman.com/view/7907941/2s93JusNJt
const crypto = require('crypto');
const http = require('../../lib/http');
const settings = require('../../lib/settings');
const config = require('../../config');

function base() {
  return settings.getBool('payments.nowpayments.sandbox') ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
}

function apiKey() {
  const k = settings.get('payments.nowpayments.api_key');
  if (!k) throw new Error('Brak klucza API NOWPayments (Ustawienia → Płatności).');
  return k;
}

async function createPayment({ asset, fiatMinor, currency, orderPublicId }) {
  const res = await http.postJson(`${base()}/payment`, {
    price_amount: (fiatMinor / 100).toFixed(2),
    price_currency: currency.toLowerCase(),
    pay_currency: asset.nowpayments,
    order_id: orderPublicId,
    order_description: `Zamówienie ${orderPublicId}`,
    ipn_callback_url: `${config.publicUrl}/webhooks/nowpayments`,
    is_fixed_rate: true,
    is_fee_paid_by_user: false,
  }, { headers: { 'x-api-key': apiKey() } });
  if (!res || !res.payment_id || !res.pay_address || !res.pay_amount) throw new Error('NOWPayments: niepełna odpowiedź przy tworzeniu płatności');
  return res;
}

async function getPayment(paymentId) {
  return http.getJson(`${base()}/payment/${encodeURIComponent(paymentId)}`, { headers: { 'x-api-key': apiKey() } });
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  }
  return v;
}

/** Weryfikacja podpisu IPN: HMAC-SHA512 z JSON-a o posortowanych kluczach, klucz = IPN secret. */
function verifySignature(body, signature) {
  const secret = settings.get('payments.nowpayments.ipn_secret');
  if (!secret || !signature || typeof body !== 'object') return false;
  const expected = crypto.createHmac('sha512', secret).update(JSON.stringify(sortKeys(body))).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const STATUS_MAP = {
  waiting: 'pending',
  confirming: 'confirming',
  confirmed: 'paid',
  sending: 'paid',
  finished: 'paid',
  partially_paid: 'underpaid',
  failed: 'failed',
  refunded: 'refunded',
  expired: 'expired',
};

async function testConnection() {
  const status = await http.getJson(`${base()}/status`);
  if (!status || status.message !== 'OK') throw new Error('API NOWPayments nie odpowiada poprawnie.');
  const coins = await http.getJson(`${base()}/merchant/coins`, { headers: { 'x-api-key': apiKey() } });
  if (!settings.get('payments.nowpayments.ipn_secret')) throw new Error('Brak IPN secret — bez niego nie da się bezpiecznie potwierdzać płatności.');
  return { coins: (coins && coins.selectedCurrencies) || [] };
}

module.exports = { createPayment, getPayment, verifySignature, STATUS_MAP, testConnection, sortKeys };
