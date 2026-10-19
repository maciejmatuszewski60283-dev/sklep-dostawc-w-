'use strict';
// TOTP (RFC 6238) — kompatybilne z Google Authenticator, Aegis, 2FAS, Authy itp.
const crypto = require('crypto');
const { base32nopad } = require('@scure/base');

const STEP = 30;
const DIGITS = 6;

function generateSecret() {
  return base32nopad.encode(crypto.randomBytes(20));
}

function codeAt(secret, step) {
  const key = Buffer.from(base32nopad.decode(secret.toUpperCase().replace(/\s+/g, '')));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Sprawdza kod z tolerancją ±1 krok. Zwraca numer kroku (do ochrony przed ponownym użyciem) albo null.
 */
function verify(secret, code, lastUsedStep = 0, now = Date.now()) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const current = Math.floor(now / 1000 / STEP);
  for (const delta of [0, -1, 1]) {
    const step = current + delta;
    if (step <= lastUsedStep) continue;
    const expected = codeAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

function otpauthUrl(secret, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

module.exports = { generateSecret, verify, otpauthUrl, codeAt, STEP };
