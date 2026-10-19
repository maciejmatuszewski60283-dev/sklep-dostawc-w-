'use strict';

const CURRENCIES = {
  PLN: { symbol: 'zł', locale: 'pl-PL' },
  EUR: { symbol: '€', locale: 'pl-PL' },
  USD: { symbol: '$', locale: 'pl-PL' },
};

function formatMinor(minor, currency = 'PLN') {
  const value = (Number(minor) || 0) / 100;
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
}

/** "12,50" / "12.5" / "12" -> 1250. Zwraca null przy błędnym formacie. */
function parseMinor(input) {
  const s = String(input ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return parseInt(i, 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
}

function minorToInput(minor) {
  if (minor == null) return '';
  return (Number(minor) / 100).toFixed(2).replace('.', ',');
}

/** Kwota atomowa (BigInt/string) -> tekst dziesiętny bez zbędnych zer. */
function atomicToDecimal(atomic, decimals) {
  const a = BigInt(atomic);
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  let frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + int.toString() + (frac ? '.' + frac : '');
}

/** Tekst dziesiętny -> BigInt w jednostkach atomowych (obcina nadmiarowe miejsca). */
function decimalToAtomic(str, decimals) {
  const s = String(str).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Niepoprawna kwota: ${s}`);
  const [i, f = ''] = s.split('.');
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

module.exports = { CURRENCIES, formatMinor, parseMinor, minorToInput, atomicToDecimal, decimalToAtomic };
