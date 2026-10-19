'use strict';
// Odczyt transakcji BTC/LTC z publicznego API typu Esplora (mempool.space, litecoinspace.org)
// lub z własnego serwera mempool/electrs — adres API ustawisz w panelu.
const http = require('../../../lib/http');

async function tipHeight(apiBase) {
  const h = await http.getJson(`${apiBase}/blocks/tip/height`);
  const n = parseInt(h, 10);
  if (!Number.isFinite(n)) throw new Error('Nieprawidłowa odpowiedź API (wysokość bloku)');
  return n;
}

/** Wszystkie wpływy na adres: [{txid, outIndex, amount(BigInt), confirmations, blockTime}] */
async function incomingTransfers(apiBase, address, tip) {
  const txs = await http.getJson(`${apiBase}/address/${encodeURIComponent(address)}/txs`);
  if (!Array.isArray(txs)) throw new Error('Nieprawidłowa odpowiedź API (lista transakcji)');
  const out = [];
  for (const tx of txs) {
    const confirmed = tx.status && tx.status.confirmed;
    const confirmations = confirmed ? Math.max(0, tip - tx.status.block_height + 1) : 0;
    (tx.vout || []).forEach((v, i) => {
      if (v.scriptpubkey_address === address) {
        out.push({
          txid: tx.txid, outIndex: i, amount: BigInt(v.value), confirmations,
          blockTime: confirmed ? tx.status.block_time : null,
        });
      }
    });
  }
  return out;
}

async function addressHasHistory(apiBase, address) {
  const info = await http.getJson(`${apiBase}/address/${encodeURIComponent(address)}`);
  const c = info.chain_stats || {};
  const m = info.mempool_stats || {};
  return (c.tx_count || 0) + (m.tx_count || 0) > 0;
}

module.exports = { tipHeight, incomingTransfers, addressHasHistory };
