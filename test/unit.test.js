'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const utxo = require('../src/services/payments/chains/utxo-address');
const fmt = require('../src/services/payments/chains/address-format');
const totp = require('../src/lib/totp');
const crypto = require('../src/lib/crypto');
const money = require('../src/lib/money');
const validate = require('../src/lib/validate');
const markdown = require('../src/lib/markdown');
const payments = require('../src/services/payments');
const nowpayments = require('../src/services/payments/nowpayments');

test('BIP84/49/44: adresy zgodne z oficjalnymi wektorami testowymi', () => {
  const z = utxo.parseExtendedKey('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs', 'btc');
  assert.equal(utxo.deriveAddress(z, 0), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(utxo.deriveAddress(z, 1), 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
  const u = utxo.parseExtendedKey('upub5EFU65HtV5TeiSHmZZm7FUffBGy8UKeqp7vw43jYbvZPpoVsgU93oac7Wk3u6moKegAEWtGNF8DehrnHtv21XXEMYRUocHqguyjknFHYfgY', 'btc-test');
  assert.equal(utxo.deriveAddress(u, 0), '2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2');
  const x = utxo.parseExtendedKey('xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj', 'btc', 'p2pkh');
  assert.equal(utxo.deriveAddress(x, 0), '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
});

test('klucz prywatny i klucz z innej sieci są odrzucane', () => {
  assert.throws(() => utxo.parseExtendedKey('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi', 'btc'), /PRYWATNY/);
  assert.throws(() => utxo.parseExtendedKey('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs', 'btc-test'), /nie pasuje/);
  assert.throws(() => utxo.parseExtendedKey('nonsense', 'btc'));
});

test('walidacja adresów EVM (suma kontrolna) i Tron', () => {
  assert.equal(fmt.evmChecksum('0xdac17f958d2ee523a2206206994597c13d831ec7'), '0xdAC17F958D2ee523a2206206994597C13D831ec7');
  assert.throws(() => fmt.evmChecksum('0xdAC17F958D2ee523a2206206994597C13D831eC7'), /suma kontrolna/i);
  assert.throws(() => fmt.evmChecksum('0x123'));
  assert.equal(fmt.tronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').hex, '41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
  assert.throws(() => fmt.tronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6x'));
});

test('TOTP: poprawny kod przechodzi, ponowne użycie i zły kod — nie', () => {
  const s = totp.generateSecret();
  const now = Date.now();
  const step = Math.floor(now / 30000);
  const code = totp.codeAt(s, step);
  const used = totp.verify(s, code, 0, now);
  assert.equal(used, step);
  assert.equal(totp.verify(s, code, used, now), null, 'kod nie może zostać użyty dwa razy');
  assert.equal(totp.verify(s, '000000', 0, now) === step && code !== '000000', false);
  // wektor RFC 6238 (SHA1, T=59s -> 94287082, 6 cyfr: 287082)
  const rfc = require('@scure/base').base32nopad.encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.codeAt(rfc, 1), '287082');
});

test('szyfrowanie, hasła, podpisane tokeny', () => {
  const blob = crypto.encrypt('KLUCZ-123');
  assert.notEqual(blob, 'KLUCZ-123');
  assert.equal(crypto.decrypt(blob), 'KLUCZ-123');
  const tampered = blob.slice(0, -2) + (blob.endsWith('A') ? 'B' : 'A') + blob.slice(-1);
  assert.throws(() => crypto.decrypt(tampered));
  const h = crypto.hashPassword('dlugie-haslo-123');
  assert.ok(crypto.verifyPassword('dlugie-haslo-123', h));
  assert.ok(!crypto.verifyPassword('zle-haslo', h));
  const t = crypto.signToken({ a: 1 }, 60);
  assert.equal(crypto.verifyToken(t).a, 1);
  assert.equal(crypto.verifyToken(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))), null);
  assert.equal(crypto.verifyToken(crypto.signToken({ a: 1 }, -5)), null);
});

test('kwoty: przeliczenie fiat -> krypto zaokrągla w górę', () => {
  assert.equal(payments.fiatToAtomic(10000, '400000', 8), 25000n); // 100 zł przy 400 000 zł/BTC = 0.00025 BTC
  assert.equal(payments.fiatToAtomic(1, '3', 8), 333334n);
  assert.equal(money.atomicToDecimal(25000n, 8), '0.00025');
  assert.equal(money.decimalToAtomic('1.5', 6), 1500000n);
  assert.equal(money.parseMinor('12,5'), 1250);
  assert.equal(money.parseMinor('12.345'), null);
  assert.equal(money.parseMinor('-1'), null);
});

test('walidacja e-mail', () => {
  assert.equal(validate.email(' Jan.Kowalski@Example.PL '), 'jan.kowalski@example.pl');
  for (const bad of ['', 'a@b', 'jan@@x.pl', 'jan@x', 'jan..k@x.pl', '<script>@x.pl', 'a'.repeat(250) + '@x.pl']) {
    assert.equal(validate.email(bad), null, bad);
  }
});

test('markdown usuwa skrypty i niebezpieczne linki (XSS)', () => {
  const html = markdown.render('**ok** <script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))');
  assert.match(html, /<strong>ok<\/strong>/);
  assert.doesNotMatch(html, /<script|onerror|javascript:/i);
});

test('NOWPayments: podpis IPN (HMAC-SHA512 z posortowanych kluczy)', () => {
  const settings = require('../src/lib/settings');
  settings.set('payments.nowpayments.ipn_secret', 'sekret');
  const body = { payment_status: 'finished', payment_id: 5, actually_paid: 1, order_id: 'NI-X' };
  const sig = require('crypto').createHmac('sha512', 'sekret').update(JSON.stringify(nowpayments.sortKeys(body))).digest('hex');
  assert.ok(nowpayments.verifySignature(body, sig));
  assert.ok(!nowpayments.verifySignature({ ...body, actually_paid: 2 }, sig));
  assert.ok(!nowpayments.verifySignature(body, ''));
});
