'use strict';
// Sieci EVM (Ethereum, BNB Smart Chain, Polygon) przez JSON-RPC.
// Tokeny (USDT/USDC) wykrywamy po zdarzeniach Transfer — działa z każdym publicznym węzłem, bez klucza API.
// Natywny ETH wykrywamy przez Etherscan API V2 (wymaga darmowego klucza API).
const http = require('../../../lib/http');

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
let rpcId = 1;

async function rpc(url, method, params) {
  const res = await http.postJson(url, { jsonrpc: '2.0', id: rpcId++, method, params }, { timeoutMs: 20000 });
  if (res && res.error) throw new Error(`RPC ${method}: ${res.error.message || JSON.stringify(res.error)}`);
  return res.result;
}

async function blockNumber(url) {
  return parseInt(await rpc(url, 'eth_blockNumber', []), 16);
}

async function chainId(url) {
  return parseInt(await rpc(url, 'eth_chainId', []), 16);
}

async function tokenDecimals(url, contract) {
  const r = await rpc(url, 'eth_call', [{ to: contract, data: '0x313ce567' }, 'latest']);
  return parseInt(r, 16);
}

function padAddress(addr) {
  return '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/** Transfery tokena na adres w zakresie bloków. */
async function tokenTransfers(url, contract, to, fromBlock, toBlock) {
  const logs = await rpc(url, 'eth_getLogs', [{
    address: contract,
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock: '0x' + toBlock.toString(16),
    topics: [TRANSFER_TOPIC, null, padAddress(to)],
  }]);
  return (logs || []).filter((l) => !l.removed).map((l) => ({
    txid: l.transactionHash,
    outIndex: parseInt(l.logIndex, 16),
    amount: BigInt(l.data === '0x' ? 0 : l.data),
    blockNumber: parseInt(l.blockNumber, 16),
  }));
}

/** Potwierdza, że transakcja się powiodła i zawiera dany transfer (ochrona przed reorganizacją łańcucha). */
async function verifyTokenTransfer(url, contract, to, transfer) {
  const receipt = await rpc(url, 'eth_getTransactionReceipt', [transfer.txid]);
  if (!receipt || receipt.status !== '0x1') return false;
  return receipt.logs.some((l) => l.address.toLowerCase() === contract.toLowerCase()
    && parseInt(l.logIndex, 16) === transfer.outIndex
    && l.topics[0] === TRANSFER_TOPIC
    && l.topics[2] && l.topics[2].toLowerCase() === padAddress(to)
    && BigInt(l.data) === transfer.amount);
}

async function verifyNativeTransfer(url, to, transfer) {
  const receipt = await rpc(url, 'eth_getTransactionReceipt', [transfer.txid]);
  if (!receipt || receipt.status !== '0x1') return false;
  if (transfer.internal) return true; // przelew wewnętrzny: sukces transakcji nadrzędnej + dane z Etherscan
  const tx = await rpc(url, 'eth_getTransactionByHash', [transfer.txid]);
  return Boolean(tx && tx.to && tx.to.toLowerCase() === to.toLowerCase() && BigInt(tx.value) === transfer.amount);
}

/** Wpływy natywnego ETH przez Etherscan V2 (zwykłe + wewnętrzne). */
async function nativeTransfers(apiKey, chain, to, fromBlock) {
  if (!apiKey) throw new Error('Brak klucza Etherscan API — dodaj go w ustawieniach płatności.');
  const base = `https://api.etherscan.io/v2/api?chainid=${chain}&module=account&address=${to}&startblock=${fromBlock}&endblock=99999999&sort=asc&apikey=${encodeURIComponent(apiKey)}`;
  const out = [];
  const internalCount = new Map();
  for (const action of ['txlist', 'txlistinternal']) {
    const res = await http.getJson(`${base}&action=${action}`);
    if (res.status !== '1' && !(res.message || '').startsWith('No transactions')) {
      throw new Error(`Etherscan: ${res.result || res.message}`);
    }
    for (const t of Array.isArray(res.result) ? res.result : []) {
      if ((t.to || '').toLowerCase() !== to.toLowerCase()) continue;
      if (t.isError === '1' || t.txreceipt_status === '0') continue;
      const v = BigInt(t.value || '0');
      if (v === 0n) continue;
      let outIndex = 0;
      if (action === 'txlistinternal') {
        outIndex = (internalCount.get(t.hash) || 0) + 1;
        internalCount.set(t.hash, outIndex);
      }
      out.push({
        txid: t.hash, outIndex,
        amount: v, blockNumber: parseInt(t.blockNumber, 10), internal: action === 'txlistinternal',
      });
    }
  }
  return out;
}

module.exports = { rpc, blockNumber, chainId, tokenDecimals, tokenTransfers, verifyTokenTransfer, verifyNativeTransfer, nativeTransfers };
