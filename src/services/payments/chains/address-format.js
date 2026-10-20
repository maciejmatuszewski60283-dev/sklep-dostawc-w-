'use strict';
const { keccak_256 } = require('@noble/hashes/sha3.js');
const { sha256 } = require('@noble/hashes/sha2.js');
const { base58check: makeB58c } = require('@scure/base');

const b58c = makeB58c(sha256);

function toHex(u8) {
  return Buffer.from(u8).toString('hex');
}

/** Zwraca adres EVM w formie z sumą kontrolną (EIP-55) albo rzuca błąd. */
function evmChecksum(addr) {
  const s = String(addr || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) throw new Error('Adres musi mieć format 0x + 40 znaków hex.');
  const lower = s.slice(2).toLowerCase();
  const hash = toHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  const mixed = s.slice(2) !== lower && s.slice(2) !== lower.toUpperCase();
  if (mixed && out !== s) throw new Error('Błędna suma kontrolna adresu — sprawdź, czy nie ma literówki.');
  if (/^0x0{40}$/.test(out)) throw new Error('Adres zerowy jest niedozwolony.');
  return out;
}

/** Waliduje adres Tron (T...). Zwraca {base58, hex} (hex z prefiksem 41). */
function tronAddress(addr) {
  const s = String(addr || '').trim();
  let raw;
  try { raw = b58c.decode(s); } catch { throw new Error('Niepoprawny adres Tron.'); }
  if (raw.length !== 21 || raw[0] !== 0x41) throw new Error('Niepoprawny adres Tron (musi zaczynać się od T).');
  return { base58: s, hex: toHex(raw) };
}

module.exports = { evmChecksum, tronAddress };
