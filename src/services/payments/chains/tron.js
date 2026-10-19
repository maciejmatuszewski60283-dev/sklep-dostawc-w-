'use strict';
// Tron (USDT TRC-20) przez TronGrid API. Zwracane są wyłącznie transakcje potwierdzone (nieodwracalne).
const http = require('../../../lib/http');

function headers(apiKey) {
  return apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};
}

async function trc20Incoming(apiBase, apiKey, address, contract, minTimestampMs) {
  const url = `${apiBase}/v1/accounts/${address}/transactions/trc20?only_to=true&only_confirmed=true&limit=200`
    + `&contract_address=${contract}&min_timestamp=${Math.max(0, Math.floor(minTimestampMs))}`;
  const res = await http.getJson(url, { headers: headers(apiKey) });
  if (!res || res.success === false) throw new Error('TronGrid: nieprawidłowa odpowiedź');
  return (res.data || [])
    .filter((t) => t.to === address && t.token_info && t.token_info.address === contract && t.type === 'Transfer')
    .map((t) => ({ txid: t.transaction_id, outIndex: 0, amount: BigInt(t.value), blockTime: Math.floor(t.block_timestamp / 1000) }));
}

async function ping(apiBase, apiKey) {
  return http.postJson(`${apiBase}/wallet/getnowblock`, {}, { headers: headers(apiKey) });
}

module.exports = { trc20Incoming, ping };
