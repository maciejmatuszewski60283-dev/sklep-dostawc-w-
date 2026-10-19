'use strict';
// Kursy kryptowalut względem waluty sklepu (CoinGecko). Wyniki buforowane, aby nie przekraczać limitów.
const http = require('../lib/http');
const events = require('../lib/events');

const TTL_MS = 60 * 1000;
const MAX_STALE_MS = 10 * 60 * 1000;
const cache = new Map(); // `${id}:${fiat}` -> { price: string, ts }

async function fetchAll(ids, fiat) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=${fiat.toLowerCase()}&precision=full`;
  const res = await http.getJson(url, { timeoutMs: 10000 });
  const now = Date.now();
  for (const id of ids) {
    const p = res && res[id] && res[id][fiat.toLowerCase()];
    if (typeof p === 'number' && p > 0) cache.set(`${id}:${fiat}`, { price: String(p), ts: now });
  }
}

/** Cena 1 jednostki krypto w walucie sklepu (jako tekst dziesiętny). Rzuca błąd, gdy kurs niedostępny. */
async function price(coingeckoId, fiat, allIds = [coingeckoId]) {
  const key = `${coingeckoId}:${fiat}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.price;
  try {
    await fetchAll([...new Set([coingeckoId, ...allIds])], fiat);
  } catch (e) {
    events.warn('payment', 'rates_fetch_failed', `Nie udało się pobrać kursów: ${e.message}`);
  }
  const fresh = cache.get(key);
  if (fresh && Date.now() - fresh.ts < MAX_STALE_MS) return fresh.price;
  throw new Error('Kurs kryptowaluty jest chwilowo niedostępny. Spróbuj ponownie za chwilę.');
}

function _set(coingeckoId, fiat, p) {
  cache.set(`${coingeckoId}:${fiat}`, { price: String(p), ts: Date.now() });
}

module.exports = { price, _set, _clear: () => cache.clear() };
