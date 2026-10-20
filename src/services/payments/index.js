'use strict';
// Silnik płatności kryptowalutowych.
//
// Własna bramka ("direct") — środki trafiają bezpośrednio do Twojego portfela, sklep nie zna kluczy prywatnych:
//  * BTC / LTC: unikalny adres dla każdego zamówienia wyprowadzany z klucza publicznego (xpub/zpub).
//    Wpływy sprawdzamy przez publiczne API (mempool.space / litecoinspace.org lub Twój własny węzeł).
//  * Sieci EVM i Tron (ETH, USDT, USDC): jeden adres odbiorczy + unikalna kwota dla każdego zamówienia
//    (końcówka kwoty identyfikuje zamówienie). Wpływy czytamy bezpośrednio z blockchaina (JSON-RPC / TronGrid).
//
// Procesor zewnętrzny ("nowpayments") — adres i kwotę generuje NOWPayments, status przychodzi webhookiem (IPN)
// z weryfikacją podpisu oraz jest dodatkowo odpytywany przez API.
//
// Zamówienie jest oznaczane jako opłacone WYŁĄCZNIE na podstawie danych z blockchaina lub podpisanego
// webhooka procesora, nigdy na podstawie powrotu klienta na stronę.

const db = require('../../db');
const settings = require('../../lib/settings');
const events = require('../../lib/events');
const { nowIso, parseDbDate } = require('../../lib/util');
const { atomicToDecimal, decimalToAtomic } = require('../../lib/money');
const { ASSETS } = require('./assets');
const pconfig = require('./config');
const rates = require('../rates');
const utxoAddr = require('./chains/utxo-address');
const esplora = require('./chains/esplora');
const evm = require('./chains/evm');
const tron = require('./chains/tron');
const addrFmt = require('./chains/address-format');
const nowpayments = require('./nowpayments');
const jobs = require('../jobs');

// ---------------------------------------------------------------------------
// Kwoty
// ---------------------------------------------------------------------------

/** Kwota w krypto (atomowo, zaokrąglona w górę) dla kwoty w walucie sklepu. */
function fiatToAtomic(fiatMinor, priceStr, decimals) {
  const priceScaled = decimalToAtomic(priceStr, 10); // cena * 1e10
  if (priceScaled <= 0n) throw new Error('Nieprawidłowy kurs');
  const num = BigInt(fiatMinor) * 10n ** BigInt(decimals) * 10n ** 10n;
  const den = priceScaled * 100n;
  return (num + den - 1n) / den;
}

function ceilTo(amount, unit) {
  return ((amount + unit - 1n) / unit) * unit;
}

// ---------------------------------------------------------------------------
// Przydział adresu (BTC/LTC) i unikalnej kwoty (EVM/Tron)
// ---------------------------------------------------------------------------

async function allocateUtxoAddress(asset, cfg) {
  const parsed = utxoAddr.parseExtendedKey(cfg.xpub, asset.utxoNet, cfg.scriptType);
  const fp = `${parsed.fingerprint}:${parsed.scriptType}`;
  const conn = db.get();
  for (let attempt = 0; attempt < 25; attempt++) {
    const slot = conn.transaction(() => {
      const free = conn.prepare("SELECT * FROM address_pool WHERE asset = ? AND xpub_fingerprint = ? AND status = 'free' ORDER BY idx LIMIT 1").get(asset.code, fp);
      if (free) {
        const r = conn.prepare("UPDATE address_pool SET status='in_use', updated_at=datetime('now') WHERE id = ? AND status='free'").run(free.id);
        if (r.changes) return { ...free, reused: true };
      }
      const max = conn.prepare('SELECT MAX(idx) AS m FROM address_pool WHERE asset = ? AND xpub_fingerprint = ?').get(asset.code, fp).m;
      const idx = max == null ? 0 : max + 1;
      const address = utxoAddr.deriveAddress(parsed, idx);
      const id = conn.prepare("INSERT INTO address_pool (asset, xpub_fingerprint, idx, address, status) VALUES (?,?,?,?, 'in_use')").run(asset.code, fp, idx, address).lastInsertRowid;
      return { id, idx, address, reused: false };
    })();
    // Adres nie może mieć historii (np. użyty wcześniej przez Twój portfel albo wpłata po wygaśnięciu).
    try {
      const used = await esplora.addressHasHistory(cfg.apiBase || asset.apiBase, slot.address);
      if (!used) return slot;
      conn.prepare("UPDATE address_pool SET status='used', updated_at=datetime('now') WHERE id = ?").run(slot.id);
    } catch (e) {
      if (slot.reused) {
        // Nie możemy potwierdzić, że ponownie używany adres jest czysty — oddaj go i weź nowy.
        conn.prepare("UPDATE address_pool SET status='free' WHERE id = ?").run(slot.id);
        const max = conn.prepare('SELECT MAX(idx) AS m FROM address_pool WHERE asset = ? AND xpub_fingerprint = ?').get(asset.code, fp).m;
        const idx = max + 1;
        const address = utxoAddr.deriveAddress(parsed, idx);
        const id = conn.prepare("INSERT INTO address_pool (asset, xpub_fingerprint, idx, address, status) VALUES (?,?,?,?, 'in_use')").run(asset.code, fp, idx, address).lastInsertRowid;
        return { id, idx, address, reused: false };
      }
      return slot; // nowy indeks jest unikalny nawet bez sprawdzenia historii
    }
  }
  throw new Error('Nie udało się przydzielić czystego adresu. Sprawdź, czy portfel jest przeznaczony wyłącznie dla sklepu.');
}

function sharedAddress(asset, cfg) {
  if (asset.kind === 'tron-token') return addrFmt.tronAddress(cfg.address).base58;
  return addrFmt.evmChecksum(cfg.address);
}

/** Unikalna kwota dla wspólnego adresu (musi być wywołana wewnątrz transakcji zapisu płatności). */
function uniqueTaggedAmount(asset, address, baseAtomic) {
  const unit = 10n ** BigInt(asset.decimals - asset.tagDecimals);
  const roundUnit = 10n ** BigInt(asset.decimals - asset.roundDecimals);
  const base = ceilTo(baseAtomic, roundUnit);
  const maxTag = Number(roundUnit / unit) - 1;
  const taken = new Set(db.get().prepare(`SELECT amount_atomic FROM payments WHERE asset = ? AND address = ?
    AND (status IN ('pending','confirming','underpaid') OR watch_until > datetime('now'))`).all(asset.code, address).map((r) => r.amount_atomic));
  for (let i = 0; i < 200; i++) {
    const tag = 1 + Math.floor(Math.random() * maxTag);
    const amount = base + BigInt(tag) * unit;
    if (!taken.has(amount.toString())) return amount;
  }
  throw new Error('Zbyt wiele równoczesnych płatności w tej sieci — spróbuj za chwilę.');
}

// ---------------------------------------------------------------------------
// Tworzenie płatności
// ---------------------------------------------------------------------------

/**
 * Przygotowuje dane płatności (operacje sieciowe). Zwraca funkcję `insert(orderId)`,
 * którą należy wywołać w tej samej transakcji, w której tworzone jest zamówienie.
 */
async function prepare({ assetCode, fiatMinor, currency, orderPublicId }) {
  const asset = ASSETS[assetCode];
  const cfg = pconfig.get(assetCode);
  if (!asset || !pconfig.isReady(assetCode, cfg)) throw new Error('Wybrana metoda płatności jest niedostępna.');
  const windowMin = settings.getInt('checkout.payment_window_minutes', 30);
  const graceH = settings.getInt('checkout.late_grace_hours', 24);
  const expiresAt = nowIso(windowMin * 60 * 1000);
  const watchUntil = nowIso((windowMin * 60 + graceH * 3600) * 1000);
  const required = Math.max(1, parseInt(cfg.confirmations, 10) || asset.defaultConfirmations);

  if (cfg.provider === 'nowpayments') {
    const np = await nowpayments.createPayment({ asset, fiatMinor, currency, orderPublicId });
    const amount = decimalToAtomic(String(np.pay_amount), asset.decimals);
    const rate = (fiatMinor / 100 / Number(np.pay_amount)).toFixed(8);
    return {
      insert(orderId) {
        return db.get().prepare(`INSERT INTO payments (order_id, provider, asset, address, amount_atomic, decimals, rate, fiat_amount_minor,
          required_confirmations, status, provider_payment_id, provider_status, expires_at, watch_until, next_check_at)
          VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?, ?, ?, ?, ?)`).run(orderId, 'nowpayments', asset.code, np.pay_address, amount.toString(),
          asset.decimals, rate, fiatMinor, required, String(np.payment_id), np.payment_status || 'waiting', expiresAt, watchUntil, Date.now() + 60000).lastInsertRowid;
      },
      release() {},
    };
  }

  const price = await rates.price(asset.coingecko, currency, [...new Set(Object.values(ASSETS).map((a) => a.coingecko))]);
  const baseAmount = fiatToAtomic(fiatMinor, price, asset.decimals);

  if (asset.kind === 'utxo') {
    const slot = await allocateUtxoAddress(asset, cfg);
    return {
      insert(orderId) {
        const id = db.get().prepare(`INSERT INTO payments (order_id, provider, asset, address, address_index, amount_atomic, decimals, rate,
          fiat_amount_minor, required_confirmations, status, expires_at, watch_until, next_check_at)
          VALUES (?, 'direct', ?,?,?,?,?,?,?,?, 'pending', ?, ?, ?)`).run(orderId, asset.code, slot.address, slot.idx, baseAmount.toString(),
          asset.decimals, price, fiatMinor, required, expiresAt, watchUntil, Date.now() + 15000).lastInsertRowid;
        db.get().prepare('UPDATE address_pool SET last_payment_id = ? WHERE id = ?').run(id, slot.id);
        return id;
      },
      release() {
        db.get().prepare("UPDATE address_pool SET status='free' WHERE id = ? AND status='in_use'").run(slot.id);
      },
    };
  }

  const address = sharedAddress(asset, cfg);
  return {
    insert(orderId) {
      const amount = uniqueTaggedAmount(asset, address, baseAmount);
      ensureCursor(asset, cfg);
      return db.get().prepare(`INSERT INTO payments (order_id, provider, asset, address, amount_atomic, decimals, rate, fiat_amount_minor,
        required_confirmations, status, expires_at, watch_until, next_check_at)
        VALUES (?, 'direct', ?,?,?,?,?,?,?, 'pending', ?, ?, 0)`).run(orderId, asset.code, address, amount.toString(), asset.decimals,
        price, fiatMinor, required, expiresAt, watchUntil).lastInsertRowid;
    },
    release() {},
  };
}

// ---------------------------------------------------------------------------
// Zmiany statusu (jedno miejsce, idempotentne)
// ---------------------------------------------------------------------------

/** Oznacza płatność jako opłaconą i uruchamia realizację zamówienia. Bezpieczne przy wielokrotnym wywołaniu. */
function markPaid(paymentId, { received, overpaid = false, source }) {
  const conn = db.get();
  return conn.transaction(() => {
    const p = conn.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!p || p.status === 'paid' || p.status === 'refunded') return false;
    const late = parseDbDate(p.expires_at) < new Date() ? 1 : 0;
    conn.prepare("UPDATE payments SET status='paid', paid_at=datetime('now'), received_atomic=?, confirmed_atomic=?, overpaid=?, late=? WHERE id=? AND status != 'paid'")
      .run(String(received ?? p.received_atomic), String(received ?? p.received_atomic), overpaid ? 1 : 0, late, paymentId);
    const r = conn.prepare(`UPDATE orders SET status='paid', paid_at=datetime('now') WHERE id=? AND status IN ('awaiting_payment','underpaid','expired')`).run(p.order_id);
    if (!r.changes) return false;
    jobs.enqueue('fulfill_order', { orderId: p.order_id }, { uniqueKey: `fulfill:${p.order_id}` });
    jobs.enqueue('notify_paid', { orderId: p.order_id }, { uniqueKey: `notify_paid:${p.order_id}` });
    events.info('payment', 'payment_paid', `Płatność #${paymentId} (${p.asset}) potwierdzona${late ? ' po terminie' : ''}${overpaid ? ', nadpłata' : ''}`,
      { paymentId, orderId: p.order_id, source });
    return true;
  })();
}

function setStatus(p, status, received) {
  const conn = db.get();
  if (p.status === status && String(p.received_atomic) === String(received)) return;
  conn.prepare('UPDATE payments SET status=?, received_atomic=? WHERE id=? AND status NOT IN (\'paid\',\'refunded\')').run(status, String(received), p.id);
  if (status === 'underpaid' || status === 'confirming') {
    events.info('payment', `payment_${status}`, `Płatność #${p.id} (${p.asset}): ${status === 'underpaid' ? 'niedopłata' : 'oczekuje na potwierdzenia'}`, { paymentId: p.id });
  }
}

/** Przelicza status płatności na podstawie listy wpływów (z blockchaina). */
async function evaluate(p, transfers, { verifyFinal = null } = {}) {
  const conn = db.get();
  const asset = ASSETS[p.asset];
  const upsert = conn.prepare(`INSERT INTO payment_txs (payment_id, asset, txid, out_index, amount_atomic, confirmations, block_time, block_number)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(asset, txid, out_index) DO UPDATE SET confirmations = excluded.confirmations,
    block_time = COALESCE(excluded.block_time, payment_txs.block_time), block_number = COALESCE(excluded.block_number, payment_txs.block_number)
    WHERE payment_txs.payment_id = excluded.payment_id`);
  for (const t of transfers) {
    upsert.run(p.id, p.asset, t.txid, t.outIndex, t.amount.toString(), t.confirmations || 0, t.blockTime || null, t.blockNumber || null);
  }
  const rows = conn.prepare('SELECT * FROM payment_txs WHERE payment_id = ?').all(p.id);
  let received = 0n;
  let confirmed = 0n;
  for (const r of rows) {
    received += BigInt(r.amount_atomic);
    if (r.confirmations >= p.required_confirmations) confirmed += BigInt(r.amount_atomic);
  }
  const expected = BigInt(p.amount_atomic);
  conn.prepare("UPDATE payments SET confirmed_atomic=?, last_checked_at=datetime('now'), check_errors=0 WHERE id=?").run(confirmed.toString(), p.id);
  if (confirmed >= expected) {
    if (verifyFinal) {
      for (const r of rows.filter((x) => x.confirmations >= p.required_confirmations)) {
        const ok = await verifyFinal({ txid: r.txid, outIndex: r.out_index, amount: BigInt(r.amount_atomic), internal: r.out_index > 0 && asset.kind === 'evm-native' });
        if (!ok) {
          events.warn('payment', 'tx_verification_failed', `Transakcja ${r.txid} nie przeszła weryfikacji końcowej`, { paymentId: p.id, txid: r.txid });
          conn.prepare('DELETE FROM payment_txs WHERE id = ?').run(r.id);
          return 'reverted';
        }
      }
    }
    markPaid(p.id, { received: received.toString(), overpaid: received > expected, source: 'chain' });
    return 'paid';
  }
  if (received >= expected) setStatus(p, 'confirming', received);
  else if (received > 0n) setStatus(p, 'underpaid', received);
  return received > 0n ? 'partial' : 'none';
}

/** Zastosowanie danych z NOWPayments (IPN lub odpytanie API). */
function applyNowpayments(p, data) {
  const conn = db.get();
  const asset = ASSETS[p.asset];
  const mapped = nowpayments.STATUS_MAP[data.payment_status];
  if (!mapped) return 'ignored';
  if (String(data.payment_id) !== String(p.provider_payment_id)) return 'mismatch';
  let received = '0';
  try { received = decimalToAtomic(String(data.actually_paid || '0'), asset.decimals).toString(); } catch { /* zostaw 0 */ }
  conn.prepare('UPDATE payments SET provider_status = ?, last_checked_at = datetime(\'now\') WHERE id = ?').run(data.payment_status, p.id);
  if (mapped === 'paid') {
    markPaid(p.id, { received, overpaid: BigInt(received) > BigInt(p.amount_atomic), source: 'nowpayments' });
    return 'paid';
  }
  if (mapped === 'confirming' || mapped === 'underpaid') {
    setStatus(p, mapped, received);
    return mapped;
  }
  if (mapped === 'expired' || mapped === 'failed') {
    if (['pending', 'underpaid'].includes(p.status)) {
      const nothing = BigInt(received) === 0n;
      conn.prepare('UPDATE payments SET status = ? WHERE id = ? AND status IN (\'pending\',\'underpaid\')').run(nothing ? mapped : 'underpaid', p.id);
      conn.prepare('UPDATE orders SET status = ? WHERE id = ? AND status = \'awaiting_payment\'').run(nothing ? 'expired' : 'underpaid', p.order_id);
    }
    return mapped;
  }
  if (mapped === 'refunded') {
    conn.prepare("UPDATE payments SET status='refunded' WHERE id=?").run(p.id);
    return mapped;
  }
  return 'pending';
}

// ---------------------------------------------------------------------------
// Monitorowanie (worker)
// ---------------------------------------------------------------------------

const scanState = new Map(); // asset -> { nextAt }

function cursorKey(code) {
  return `cursor.${code}`;
}

function ensureCursor(asset, cfg) {
  // Kursor ustawiany asynchronicznie przy pierwszym skanie (patrz scanShared)
  return { asset, cfg };
}

function nextInterval(p) {
  const created = parseDbDate(p.created_at).getTime();
  const age = Date.now() - created;
  if (p.status === 'confirming') return 30 * 1000;
  if (age < 45 * 60 * 1000) return 20 * 1000;
  if (age < 3 * 3600 * 1000) return 60 * 1000;
  return 5 * 60 * 1000;
}

function scheduleNext(p, error = false) {
  const conn = db.get();
  if (error) {
    const errs = p.check_errors + 1;
    conn.prepare('UPDATE payments SET check_errors = ?, next_check_at = ? WHERE id = ?').run(errs, Date.now() + Math.min(10 * 60 * 1000, 20000 * 2 ** Math.min(errs, 5)), p.id);
  } else {
    conn.prepare('UPDATE payments SET next_check_at = ? WHERE id = ?').run(Date.now() + nextInterval(p), p.id);
  }
}

async function checkUtxo(p) {
  const asset = ASSETS[p.asset];
  const cfg = pconfig.get(p.asset);
  const api = cfg.apiBase || asset.apiBase;
  const tip = await esplora.tipHeight(api);
  const transfers = await esplora.incomingTransfers(api, p.address, tip);
  return evaluate(p, transfers);
}

async function checkNowpayments(p) {
  const data = await nowpayments.getPayment(p.provider_payment_id);
  return applyNowpayments(p, data);
}

/** Skan wspólnego adresu (EVM/Tron) i dopasowanie wpływów po unikalnej kwocie. */
async function scanShared(code) {
  const asset = ASSETS[code];
  const cfg = pconfig.get(code);
  const conn = db.get();
  const active = conn.prepare(`SELECT * FROM payments WHERE asset = ? AND provider = 'direct'
    AND (status = 'confirming' OR (status IN ('pending','underpaid') AND watch_until > datetime('now')))`).all(code);
  if (!active.length) return;
  let transfers = [];
  let head = null;
  let verifyFinal = null;

  if (asset.kind === 'tron-token') {
    const oldest = Math.min(...active.map((p) => parseDbDate(p.created_at).getTime()));
    transfers = (await tron.trc20Incoming(cfg.apiBase || asset.apiBase, settings.get('payments.trongrid_api_key'), active[0].address, asset.contract, oldest - 5 * 60 * 1000))
      .map((t) => ({ ...t, confirmations: Number.MAX_SAFE_INTEGER, createdMs: t.blockTime * 1000 }));
  } else {
    const rpcUrl = cfg.rpc || asset.rpc;
    head = await evm.blockNumber(rpcUrl);
    const stored = parseInt(settings.get(cursorKey(code)), 10);
    let from = Number.isFinite(stored) ? stored + 1 : head - 50;
    from = Math.max(from, head - 20000); // nie cofamy się dalej niż ~kilka godzin
    const CHUNK = 2000;
    const to = asset.kind === 'evm-token' ? Math.min(head, from + CHUNK * 5 - 1) : head;
    if (asset.kind === 'evm-token') {
      for (let b = from; b <= to; b += CHUNK) {
        transfers.push(...await evm.tokenTransfers(rpcUrl, asset.contract, active[0].address, b, Math.min(to, b + CHUNK - 1)));
      }
      verifyFinal = (t) => evm.verifyTokenTransfer(rpcUrl, asset.contract, active[0].address, t);
    } else {
      transfers = await evm.nativeTransfers(settings.get('payments.etherscan_api_key'), asset.chainId, active[0].address, Math.max(0, from - 20));
      verifyFinal = (t) => evm.verifyNativeTransfer(rpcUrl, active[0].address, t);
    }
    settings.set(cursorKey(code), String(to));
  }

  // 1) Nowe wpływy: dopasuj po dokładnej kwocie do aktywnych płatności, resztę zapisz jako nieprzypisane
  const known = conn.prepare('SELECT 1 FROM payment_txs WHERE asset = ? AND txid = ? AND out_index = ?');
  const knownUnmatched = conn.prepare('SELECT 1 FROM unmatched_transfers WHERE asset = ? AND txid = ? AND out_index = ?');
  for (const t of transfers) {
    if (known.get(code, t.txid, t.outIndex) || knownUnmatched.get(code, t.txid, t.outIndex)) continue;
    const match = active.find((p) => p.amount_atomic === t.amount.toString() && p.status !== 'paid'
      && (!t.createdMs || t.createdMs >= parseDbDate(p.created_at).getTime() - 10 * 60 * 1000));
    const confs = head != null && t.blockNumber ? head - t.blockNumber + 1 : t.confirmations;
    if (match) {
      conn.prepare(`INSERT OR IGNORE INTO payment_txs (payment_id, asset, txid, out_index, amount_atomic, confirmations, block_time, block_number)
        VALUES (?,?,?,?,?,?,?,?)`).run(match.id, code, t.txid, t.outIndex, t.amount.toString(), Math.min(confs, 1e9), t.blockTime || null, t.blockNumber || null);
    } else {
      conn.prepare('INSERT OR IGNORE INTO unmatched_transfers (asset, txid, out_index, amount_atomic, block_number, block_time) VALUES (?,?,?,?,?,?)')
        .run(code, t.txid, t.outIndex, t.amount.toString(), t.blockNumber || null, t.blockTime || null);
      events.warn('payment', 'unmatched_transfer', `Wpływ ${atomicToDecimal(t.amount, asset.decimals)} ${asset.symbol} bez pasującego zamówienia — przypisz ręcznie w panelu`, { asset: code, txid: t.txid });
    }
  }

  // 2) Aktualizacja potwierdzeń i statusów
  for (const p of active) {
    const txs = conn.prepare('SELECT * FROM payment_txs WHERE payment_id = ?').all(p.id);
    if (!txs.length) continue;
    const updated = txs.map((r) => ({
      txid: r.txid, outIndex: r.out_index, amount: BigInt(r.amount_atomic), blockTime: r.block_time, blockNumber: r.block_number,
      confirmations: head != null && r.block_number ? head - r.block_number + 1 : r.confirmations,
    }));
    await evaluate(p, updated, { verifyFinal });
  }
}

/** Zamyka płatności, których okno obserwacji minęło. */
function finalizeExpired() {
  const conn = db.get();
  const rows = conn.prepare(`SELECT * FROM payments WHERE status IN ('pending','underpaid') AND watch_until <= datetime('now')`).all();
  for (const p of rows) {
    conn.transaction(() => {
      if (p.status === 'pending') {
        conn.prepare("UPDATE payments SET status='expired' WHERE id=? AND status='pending'").run(p.id);
        conn.prepare("UPDATE orders SET status='expired' WHERE id=? AND status='awaiting_payment'").run(p.order_id);
        if (p.address_index != null) {
          conn.prepare("UPDATE address_pool SET status='free', updated_at=datetime('now') WHERE asset=? AND address=? AND status='in_use'").run(p.asset, p.address);
        }
      } else {
        conn.prepare("UPDATE orders SET status='underpaid' WHERE id=? AND status='awaiting_payment'").run(p.order_id);
        if (p.address_index != null) conn.prepare("UPDATE address_pool SET status='used' WHERE asset=? AND address=?").run(p.asset, p.address);
        events.warn('payment', 'payment_underpaid_final', `Płatność #${p.id}: niedopłata po terminie — wymaga decyzji obsługi`, { paymentId: p.id, orderId: p.order_id });
        jobs.enqueue('notify_admin', { subject: 'Niedopłacone zamówienie', message: `Zamówienie #${p.order_id} zostało niedopłacone. Sprawdź je w panelu.` }, { uniqueKey: `underpaid:${p.id}` });
      }
    })();
  }
  // Zamówienia, którym minął termin, a płatność nadal czeka na spóźnione wpływy, pozostają "awaiting_payment"
  // (ale ich rezerwacja magazynu wygasa — patrz catalog.AVAILABLE_SQL).
}

let watcherTimer = null;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    finalizeExpired();
    const conn = db.get();
    const due = conn.prepare(`SELECT * FROM payments WHERE next_check_at <= ?
      AND (status = 'confirming' OR (status IN ('pending','underpaid') AND watch_until > datetime('now'))) ORDER BY next_check_at LIMIT 40`).all(Date.now());
    const sharedAssets = new Set();
    for (const p of due) {
      const asset = ASSETS[p.asset];
      if (!asset) continue;
      if (p.provider === 'direct' && asset.kind !== 'utxo') { sharedAssets.add(p.asset); continue; }
      try {
        if (p.provider === 'nowpayments') await checkNowpayments(p);
        else await checkUtxo(p);
        scheduleNext(conn.prepare('SELECT * FROM payments WHERE id=?').get(p.id));
      } catch (e) {
        scheduleNext(p, true);
        events.warn('payment', 'check_failed', `Sprawdzenie płatności #${p.id} (${p.asset}) nie powiodło się: ${e.message}`, { paymentId: p.id });
      }
    }
    for (const code of sharedAssets) {
      const st = scanState.get(code) || { nextAt: 0, errors: 0 };
      if (st.nextAt > Date.now()) continue;
      try {
        await scanShared(code);
        scanState.set(code, { nextAt: Date.now() + 20000, errors: 0 });
      } catch (e) {
        const errors = st.errors + 1;
        scanState.set(code, { nextAt: Date.now() + Math.min(10 * 60 * 1000, 20000 * 2 ** Math.min(errors, 5)), errors });
        events.warn('payment', 'scan_failed', `Skan sieci ${code} nie powiódł się: ${e.message}`, { asset: code });
      }
    }
  } finally {
    ticking = false;
  }
}

function startWatcher(intervalMs = 5000) {
  watcherTimer = setInterval(() => { tick().catch((e) => console.error('[payments]', e)); }, intervalMs);
  watcherTimer.unref();
}

function stopWatcher() {
  if (watcherTimer) clearInterval(watcherTimer);
}

// ---------------------------------------------------------------------------
// Ręczne przypisanie wpływu (panel) i zgłoszenia klientów
// ---------------------------------------------------------------------------

/** Przypisuje nieprzypisany wpływ z blockchaina do płatności (decyzja administratora). */
async function assignUnmatched(unmatchedId, paymentId, ctx) {
  const conn = db.get();
  const u = conn.prepare('SELECT * FROM unmatched_transfers WHERE id = ? AND assigned_payment_id IS NULL').get(unmatchedId);
  const p = conn.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!u || !p) throw new Error('Nie znaleziono wpływu lub płatności.');
  if (u.asset !== p.asset) throw new Error('Wpływ dotyczy innej sieci niż płatność.');
  if (['paid', 'refunded'].includes(p.status)) throw new Error('Ta płatność jest już rozliczona.');
  conn.transaction(() => {
    conn.prepare('UPDATE unmatched_transfers SET assigned_payment_id = ? WHERE id = ?').run(p.id, u.id);
    conn.prepare(`INSERT INTO payment_txs (payment_id, asset, txid, out_index, amount_atomic, confirmations, block_time, block_number, source)
      VALUES (?,?,?,?,?,?,?,?, 'manual')`).run(p.id, u.asset, u.txid, u.out_index, u.amount_atomic, 0, u.block_time, u.block_number);
    conn.prepare("UPDATE payments SET status = CASE WHEN status IN ('expired','failed') THEN 'pending' ELSE status END, watch_until = MAX(watch_until, datetime('now', '+2 hours')), next_check_at = 0 WHERE id = ?").run(p.id);
    conn.prepare("UPDATE orders SET status='awaiting_payment' WHERE id = ? AND status IN ('expired','underpaid')").run(p.order_id);
    conn.prepare("UPDATE payment_claims SET status='accepted' WHERE payment_id = ? AND txid = ?").run(p.id, u.txid);
  })();
  scanState.delete(p.asset);
  events.info('payment', 'manual_assign', `Wpływ ${u.txid} przypisany ręcznie do płatności #${p.id}`, { paymentId: p.id, txid: u.txid }, ctx);
  // Status (z liczbą potwierdzeń i weryfikacją) ustali najbliższy skan sieci.
  await scanShared(p.asset).catch((e) => events.warn('payment', 'scan_failed', e.message));
}

function claim(paymentId, txid) {
  const clean = String(txid || '').trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(clean)) return { error: 'To nie wygląda na identyfikator transakcji (hash).' };
  const r = db.get().prepare('INSERT OR IGNORE INTO payment_claims (payment_id, txid) VALUES (?, ?)').run(paymentId, clean);
  if (r.changes) {
    events.info('payment', 'customer_claim', `Klient zgłosił transakcję dla płatności #${paymentId}`, { paymentId, txid: clean });
    jobs.enqueue('notify_admin', { subject: 'Zgłoszenie płatności od klienta', message: `Klient zgłosił transakcję ${clean} dla płatności #${paymentId}. Sprawdź Panel → Płatności.` });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Test konfiguracji sieci (panel)
// ---------------------------------------------------------------------------

async function testAsset(code, cfg) {
  const asset = ASSETS[code];
  const report = { ok: false, lines: [], addresses: [] };
  const line = (s) => report.lines.push(s);
  if (cfg.provider === 'nowpayments') {
    if (asset.directOnly) throw new Error('Ta sieć działa tylko z własną bramką.');
    const r = await nowpayments.testConnection();
    line('Połączenie z NOWPayments: OK');
    const coins = r.coins.map((c) => String(c).toLowerCase());
    if (coins.length && !coins.includes(asset.nowpayments)) {
      throw new Error(`Waluta "${asset.nowpayments}" nie jest włączona na Twoim koncie NOWPayments (Settings → Coins).`);
    }
    line(`Waluta ${asset.nowpayments} dostępna na koncie.`);
    report.ok = true;
    return report;
  }
  if (asset.kind === 'utxo') {
    const parsed = utxoAddr.parseExtendedKey(cfg.xpub, asset.utxoNet, cfg.scriptType);
    line(`Klucz publiczny rozpoznany (${parsed.prefix}), typ adresów: ${parsed.scriptType}.`);
    for (let i = 0; i < 3; i++) report.addresses.push(utxoAddr.deriveAddress(parsed, i));
    const api = cfg.apiBase || asset.apiBase;
    const tip = await esplora.tipHeight(api);
    line(`API blockchaina odpowiada (${new URL(api).host}), aktualny blok: ${tip}.`);
    line('WAŻNE: porównaj powyższe adresy z pierwszymi adresami odbiorczymi w swoim portfelu. Muszą być identyczne.');
    report.ok = true;
    return report;
  }
  if (asset.kind === 'tron-token') {
    const a = addrFmt.tronAddress(cfg.address);
    await tron.ping(cfg.apiBase || asset.apiBase, settings.get('payments.trongrid_api_key'));
    line(`Adres ${a.base58} poprawny. TronGrid odpowiada.`);
    report.addresses.push(a.base58);
    report.ok = true;
    return report;
  }
  const address = addrFmt.evmChecksum(cfg.address);
  report.addresses.push(address);
  const rpcUrl = cfg.rpc || asset.rpc;
  const cid = await evm.chainId(rpcUrl);
  if (cid !== asset.chainId) throw new Error(`Węzeł RPC należy do innej sieci (chainId ${cid}, oczekiwano ${asset.chainId}).`);
  const head = await evm.blockNumber(rpcUrl);
  line(`Węzeł RPC odpowiada (${new URL(rpcUrl).host}), sieć ${asset.network}, blok ${head}.`);
  if (asset.kind === 'evm-token') {
    const dec = await evm.tokenDecimals(rpcUrl, asset.contract);
    if (dec !== asset.decimals) throw new Error(`Kontrakt tokena zwraca ${dec} miejsc po przecinku zamiast ${asset.decimals}.`);
    line(`Kontrakt ${asset.symbol} zweryfikowany (${asset.contract}).`);
  } else {
    await evm.nativeTransfers(settings.get('payments.etherscan_api_key'), asset.chainId, address, head - 10);
    line('Klucz Etherscan API działa.');
  }
  line('Upewnij się, że to adres z portfela, do którego masz frazę odzyskiwania (nie adres giełdy!).');
  report.ok = true;
  return report;
}

module.exports = {
  prepare, markPaid, evaluate, applyNowpayments, tick, startWatcher, stopWatcher, finalizeExpired, scanShared,
  assignUnmatched, claim, testAsset, fiatToAtomic, uniqueTaggedAmount, _scanState: scanState,
};
