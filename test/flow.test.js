'use strict';
// Testy krytycznych ścieżek: panel -> produkt -> magazyn -> konfiguracja płatności -> zakup -> płatność -> dostawa -> e-mail.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const h = require('./helpers');
const totp = require('../src/lib/totp');
const crypto = require('../src/lib/crypto');
const auth = require('../src/services/admin-auth');
const jobs = require('../src/services/jobs');
const payments = require('../src/services/payments');
const rates = require('../src/services/rates');
const settings = require('../src/lib/settings');
const config = require('../src/config');

const A = config.adminPath;
const VPUB = 'vpub5Y6cjg78GGuNLsaPhmYsiw4gYX3HoQiRBiSwDaBXKUafCt9bNwWQiitDk5VZ5BVxYnQdwoTyXSs2JHRPAgjAvtbBrf8ZhDYe2jWAqvZVnsc';
let app;
let adminAgent;

/** Esplora (BTC testnet) — stan symulowanego łańcucha. */
const chain = { tip: 1000, txs: new Map() };
function mockChain() {
  h.mock(/mempool\.space\/testnet4\/api\/blocks\/tip\/height/, () => String(chain.tip));
  h.mock(/mempool\.space\/testnet4\/api\/address\/[^/]+\/txs$/, (url) => {
    const addr = decodeURIComponent(url.split('/address/')[1].split('/')[0]);
    return chain.txs.get(addr) || [];
  });
  h.mock(/mempool\.space\/testnet4\/api\/address\/[^/]+$/, (url) => {
    const addr = decodeURIComponent(url.split('/address/')[1]);
    return { chain_stats: { tx_count: (chain.txs.get(addr) || []).length }, mempool_stats: { tx_count: 0 } };
  });
  h.mock(/api\.coingecko\.com/, () => ({ bitcoin: { pln: 400000 }, litecoin: { pln: 400 }, ethereum: { pln: 10000 }, tether: { pln: 4 }, 'usd-coin': { pln: 4 } }));
}

function payTx(address, sats, height = null) {
  const tx = {
    txid: crypto.sha256(`${address}:${sats}:${Math.random()}`),
    status: height ? { confirmed: true, block_height: height, block_time: Math.floor(Date.now() / 1000) } : { confirmed: false },
    vout: [{ scriptpubkey_address: address, value: sats }, { scriptpubkey_address: 'tb1qinnyadres', value: 999 }],
  };
  chain.txs.set(address, [...(chain.txs.get(address) || []), tx]);
  return tx;
}

async function loginAdmin(username, password) {
  const a = h.agent(app);
  let token = await a.csrf(`${A}/login`);
  let res = await a.post(`${A}/login`).type('form').send({ _csrf: token, username, password });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, `${A}/2fa`);
  const user = h.conn().prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  token = await a.csrf(`${A}/2fa`);
  if (!user.totp_enabled) {
    const page = await a.get(`${A}/2fa`);
    const secret = /<code class="mono">([A-Z2-7 ]+)<\/code>/.exec(page.text)[1].replace(/ /g, '');
    res = await a.post(`${A}/2fa`).type('form').send({ _csrf: token, code: totp.codeAt(secret, Math.floor(Date.now() / 30000)) });
    assert.equal(res.status, 200);
    assert.match(res.text, /Kody odzyskiwania/);
  } else {
    const fresh = h.conn().prepare('SELECT * FROM admin_users WHERE id = ?').get(user.id);
    const secret = crypto.decrypt(fresh.totp_secret_enc);
    const step = Math.floor(Date.now() / 30000);
    res = await a.post(`${A}/2fa`).type('form').send({ _csrf: token, code: totp.codeAt(secret, step + (fresh.totp_last_step >= step ? 1 : 0)) });
    assert.equal(res.status, 302);
  }
  return a;
}

async function pngBuffer() {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#335577' } }).png().toBuffer();
}

async function createProduct(a, { name, deliveryType = 'keys', price = '25,00', stock = '' }) {
  const token = await a.csrf(`${A}/produkty/nowy`);
  const res = await a.post(`${A}/produkty/nowy?_csrf=${token}`)
    .field('_csrf', token).field('name', name).field('short_description', 'Opis').field('description_md', '## Opis\n- punkt')
    .field('delivery_type', deliveryType).field('rights_confirmed', '1').field('active', '1')
    .field('v_0_name', 'Standard').field('v_0_price', price).field('v_0_active', '1').field('v_0_stock', stock)
    .attach('images', await pngBuffer(), { filename: 'cover.png', contentType: 'image/png' });
  assert.equal(res.status, 302, res.text);
  const id = Number(res.headers.location.split('/').pop());
  const variant = h.conn().prepare('SELECT * FROM variants WHERE product_id = ?').get(id);
  const product = h.conn().prepare('SELECT * FROM products WHERE id = ?').get(id);
  return { id, variant, product };
}

async function addKeys(a, variantId, keys) {
  const token = await a.csrf(`${A}/magazyn/${variantId}`);
  const res = await a.post(`${A}/magazyn/${variantId}/dodaj`).type('form').send({ _csrf: token, keys: keys.join('\n') });
  assert.equal(res.status, 302);
}

async function buy(variantId, { qty = 1, email = 'klient@example.com', asset = 'BTC_TESTNET' } = {}) {
  const c = h.agent(app);
  let token = await c.csrf('/zamowienie');
  let res = await c.post('/koszyk/dodaj').type('form').send({ _csrf: token, variant_id: variantId, qty });
  assert.equal(res.status, 302);
  token = await c.csrf('/kasa');
  res = await c.post('/kasa').type('form').send({ _csrf: token, email, email2: email, asset, terms: '1', withdrawal: '1' });
  assert.equal(res.status, 302, res.text.slice(0, 3000));
  const pid = res.headers.location.split('/').pop();
  const order = h.conn().prepare('SELECT * FROM orders WHERE public_id = ?').get(pid);
  const payment = h.conn().prepare('SELECT * FROM payments WHERE order_id = ?').get(order.id);
  return { c, order, payment, pid };
}

async function tickAndDrain() {
  h.conn().prepare('UPDATE payments SET next_check_at = 0').run();
  payments._scanState.clear();
  await payments.tick();
  await jobs.drain();
  await jobs.drain();
}

before(async () => {
  app = h.createApp();
  mockChain();
  auth.createUser({ username: 'owner', password: 'bardzo-tajne-haslo-1', role: 'owner' });
  adminAgent = await loginAdmin('owner', 'bardzo-tajne-haslo-1');
});

beforeEach(() => {
  h.resetMocks();
  mockChain();
  rates._clear();
  h.setMailFail(false);
});

test('panel wymaga logowania, a nieudane logowania blokują konto', async () => {
  const anon = h.agent(app);
  const res = await anon.get(`${A}/produkty`);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /login/);
  auth.createUser({ username: 'ofiara', password: 'jakies-dlugie-haslo', role: 'support' });
  for (let i = 0; i < 5; i++) {
    const t = await anon.csrf(`${A}/login`);
    const r = await anon.post(`${A}/login`).type('form').send({ _csrf: t, username: 'ofiara', password: 'zle' });
    assert.equal(r.status, 401);
  }
  const t = await anon.csrf(`${A}/login`);
  const r = await anon.post(`${A}/login`).type('form').send({ _csrf: t, username: 'ofiara', password: 'jakies-dlugie-haslo' });
  assert.equal(r.status, 429, 'po 5 błędach konto jest czasowo zablokowane nawet przy dobrym haśle');
});

test('rola "obsługa klienta" nie ma dostępu do ustawień ani produktów', async () => {
  auth.createUser({ username: 'support1', password: 'haslo-obslugi-123', role: 'support' });
  const s = await loginAdmin('support1', 'haslo-obslugi-123');
  assert.equal((await s.get(`${A}/ustawienia/platnosci`)).status, 403);
  assert.equal((await s.get(`${A}/produkty`)).status, 403);
  assert.equal((await s.get(`${A}/zamowienia`)).status, 200);
});

test('żądanie POST bez tokenu CSRF jest odrzucane', async () => {
  const res = await h.request(app).post('/koszyk/dodaj').type('form').send({ variant_id: 1 });
  assert.equal(res.status, 403);
});

test('konfiguracja sieci: test pokazuje adresy, a sieć wymaga świadomego włączenia', async () => {
  const token = await adminAgent.csrf(`${A}/ustawienia/platnosci`);
  let res = await adminAgent.post(`${A}/ustawienia/platnosci/BTC_TESTNET`).type('form')
    .send({ _csrf: token, action: 'test', xpub: VPUB, scriptType: 'auto', confirmations: '2', apiBase: '' });
  assert.equal(res.status, 302);
  const page = await adminAgent.get(`${A}/ustawienia/platnosci`);
  assert.match(page.text, /test zakończony powodzeniem/);
  assert.match(page.text, /tb1q/);
  assert.equal(require('../src/services/payments/config').enabledAssets().length, 0, 'po teście sieć nie jest jeszcze aktywna');
  res = await adminAgent.post(`${A}/ustawienia/platnosci/BTC_TESTNET`).type('form').send({ _csrf: token, action: 'enable', xpub: VPUB });
  assert.equal(require('../src/services/payments/config').enabledAssets().length, 1);
  // Zła konfiguracja (klucz z mainnetu) — test nie przechodzi i sieć zostaje wyłączona
  const bad = await adminAgent.post(`${A}/ustawienia/platnosci/LTC`).type('form').send({ _csrf: token, action: 'test', xpub: 'abc', provider: 'direct' });
  assert.equal(bad.status, 302);
  assert.match((await adminAgent.get(`${A}/ustawienia/platnosci`)).text, /test nie powiódł się/);
});

test('pełna ścieżka: produkt -> zakup BTC -> potwierdzenia -> automatyczna dostawa -> e-mail -> odbiór', async () => {
  const { variant, product } = await createProduct(adminAgent, { name: 'Gra testowa', price: '100,00' });
  assert.ok(h.conn().prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').get(product.id).n === 1, 'zdjęcie zapisane');
  await addKeys(adminAgent, variant.id, ['KEY-AAAA-0001', 'KEY-AAAA-0002', 'KEY-AAAA-0001']);
  assert.equal(h.conn().prepare("SELECT COUNT(*) AS n FROM stock_items WHERE variant_id = ? AND status='available'").get(variant.id).n, 2, 'duplikat pominięty');
  const stored = h.conn().prepare('SELECT content_enc FROM stock_items LIMIT 1').get().content_enc;
  assert.doesNotMatch(stored, /KEY-AAAA/, 'klucze są zaszyfrowane w bazie');

  // Strona produktu publicznie dostępna
  const pp = await h.request(app).get(`/produkt/${product.slug}`);
  assert.equal(pp.status, 200);
  assert.match(pp.text, /Gra testowa/);

  const before = h.sent.length;
  const { c, order, payment, pid } = await buy(variant.id);
  assert.equal(order.status, 'awaiting_payment');
  assert.equal(payment.amount_atomic, '25000'); // 100 zł / 400 000 zł = 0.00025 BTC
  assert.match(payment.address, /^tb1q/);

  // E-mail z instrukcją płatności
  await jobs.drain();
  const created = h.sent.slice(before).find((m) => /instrukcja płatności/.test(m.subject));
  assert.ok(created, 'wysłano e-mail z instrukcją płatności');
  assert.match(created.text, /0\.00025 tBTC/);

  // Strona zamówienia: adres, kwota, QR
  let page = await c.get(`/zamowienie/${pid}`);
  assert.equal(page.status, 200);
  assert.match(page.text, new RegExp(payment.address));
  assert.match(page.text, /<svg/);

  // Powrót na stronę NIE oznacza płatności
  await tickAndDrain();
  assert.equal(h.conn().prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status, 'awaiting_payment');

  // Transakcja w mempoolu -> "confirming"
  payTx(payment.address, 25000);
  await tickAndDrain();
  assert.equal(h.conn().prepare('SELECT status FROM payments WHERE id = ?').get(payment.id).status, 'confirming');
  // 1 potwierdzenie z 2 wymaganych -> nadal czeka
  chain.txs.get(payment.address)[0].status = { confirmed: true, block_height: chain.tip, block_time: 1 };
  await tickAndDrain();
  assert.equal(h.conn().prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status, 'awaiting_payment');
  // 2 potwierdzenia -> opłacone -> zrealizowane
  chain.tip += 1;
  await tickAndDrain();
  const done = h.conn().prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  assert.equal(done.status, 'fulfilled');
  const deliveredMail = h.sent.find((m) => m.to === 'klient@example.com' && /odbierz produkty/.test(m.subject));
  assert.ok(deliveredMail, 'wysłano e-mail z dostawą');
  assert.doesNotMatch(deliveredMail.html + deliveredMail.text, /KEY-AAAA/, 'klucz NIE jest w treści e-maila');
  assert.match(deliveredMail.text, new RegExp(pid));

  // Powtórne przetworzenie nie dubluje dostawy ani e-maili
  const mailsNow = h.sent.length;
  payments.markPaid(payment.id, { received: '25000', source: 'test-dup' });
  require('../src/services/delivery').fulfill(order.id);
  await tickAndDrain();
  assert.equal(h.sent.length, mailsNow);
  assert.equal(h.conn().prepare('SELECT COUNT(*) AS n FROM stock_items WHERE status = ?').get('sold').n, 1);

  // Klient otwiera link z e-maila w nowej przeglądarce i odbiera klucz
  const link = /(http:\/\/shop\.test\/zamowienie\/\S+)/.exec(deliveredMail.text)[1];
  const fresh = h.agent(app);
  const r1 = await fresh.get(link.replace('http://shop.test', ''));
  assert.equal(r1.status, 302, 'token jest usuwany z adresu');
  page = await fresh.get(`/zamowienie/${pid}`);
  assert.match(page.text, /Odbierz produkty/);
  assert.doesNotMatch(page.text, /KEY-AAAA/, 'klucz widoczny dopiero po kliknięciu');
  const token = /name="_csrf" value="([^"]+)"/.exec(page.text)[1];
  const reveal = await fresh.post(`/zamowienie/${pid}/odbierz`).type('form').send({ _csrf: token });
  assert.match(reveal.text, /KEY-AAAA-000[12]/);
  assert.equal(reveal.headers['cache-control'], 'no-store');

  // Obca przeglądarka bez linku nie ma dostępu
  assert.equal((await h.request(app).get(`/zamowienie/${pid}`)).status, 403);
  assert.equal((await h.request(app).get(`/zamowienie/${pid}?k=zlytoken`)).status, 403);
});

test('brak towaru: opłacone zamówienie czeka, a po dodaniu kluczy realizuje się samo', async () => {
  const { variant } = await createProduct(adminAgent, { name: 'Produkt bez kluczy', price: '40,00' });
  await addKeys(adminAgent, variant.id, ['ONE-KEY']);
  const { order, payment } = await buy(variant.id);
  // ktoś wyczerpał magazyn (np. usunięcie klucza przez admina) zanim przyszła płatność
  h.conn().prepare("UPDATE stock_items SET status='removed' WHERE variant_id = ?").run(variant.id);
  payTx(payment.address, Number(payment.amount_atomic), chain.tip - 3);
  await tickAndDrain();
  let o = h.conn().prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  assert.equal(o.status, 'awaiting_stock', 'nie oznaczamy pustego zamówienia jako zrealizowanego');
  assert.ok(h.sent.some((m) => m.subject.includes(order.public_id) && /przygotowujemy/.test(m.subject)));
  assert.ok(!h.sent.some((m) => m.subject.includes(order.public_id) && /odbierz produkty/.test(m.subject)));
  await addKeys(adminAgent, variant.id, ['NEW-KEY-1']);
  await jobs.drain();
  o = h.conn().prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  assert.equal(o.status, 'fulfilled');
});

test('rezerwacja magazynu: nie da się kupić więcej niż jest dostępne', async () => {
  const { variant } = await createProduct(adminAgent, { name: 'Ostatnia sztuka', price: '10,00' });
  await addKeys(adminAgent, variant.id, ['LAST-1']);
  await buy(variant.id, { email: 'a@example.com' });
  const c = h.agent(app);
  const token = await c.csrf('/zamowienie');
  const res = await c.post('/koszyk/dodaj').set('accept', 'application/json').type('form').send({ _csrf: token, variant_id: variant.id, qty: 1 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /niedostępny/);
});

test('niedopłata: dopłata przed terminem kończy płatność; nadpłata jest oznaczana', async () => {
  const { variant } = await createProduct(adminAgent, { name: 'Niedopłata', price: '20,00', deliveryType: 'manual' });
  const { order, payment } = await buy(variant.id);
  const need = Number(payment.amount_atomic);
  payTx(payment.address, Math.floor(need / 2), chain.tip - 5);
  await tickAndDrain();
  assert.equal(h.conn().prepare('SELECT status FROM payments WHERE id = ?').get(payment.id).status, 'underpaid');
  payTx(payment.address, need, chain.tip - 5); // dopłata z nadwyżką
  await tickAndDrain();
  const p = h.conn().prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
  assert.equal(p.status, 'paid');
  assert.equal(p.overpaid, 1);
  // Produkt z realizacją ręczną czeka na obsługę
  assert.equal(h.conn().prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status, 'awaiting_stock');
});

test('wygaśnięcie: brak płatności po czasie -> zamówienie wygasa, adres wraca do puli', async () => {
  const { variant } = await createProduct(adminAgent, { name: 'Wygasające', price: '15,00', deliveryType: 'manual' });
  const { order, payment } = await buy(variant.id, { email: 'wygasa@example.com' });
  h.conn().prepare("UPDATE payments SET expires_at = datetime('now','-2 hours'), watch_until = datetime('now','-1 minute') WHERE id = ?").run(payment.id);
  await tickAndDrain();
  assert.equal(h.conn().prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status, 'expired');
  assert.equal(h.conn().prepare('SELECT status FROM address_pool WHERE address = ?').get(payment.address).status, 'free');
  const next = await buy(variant.id, { email: 'kolejny@example.com' });
  assert.equal(next.payment.address, payment.address, 'czysty adres z wygasłego zamówienia jest użyty ponownie');
});

test('błąd wysyłki e-maila: ponowienia, status "failed" i ręczne ponowienie z panelu', async () => {
  const email = require('../src/services/email');
  h.setMailFail(true);
  const id = email.queue({ to: 'x@example.com', kind: 'test', subject: 'Test błędu', template: 'test', data: {} });
  for (let i = 0; i < 6; i++) {
    h.conn().prepare("UPDATE jobs SET run_at = 0 WHERE status = 'queued'").run();
    await jobs.drain();
  }
  assert.equal(h.conn().prepare('SELECT status FROM emails WHERE id = ?').get(id).status, 'failed');
  h.setMailFail(false);
  const token = await adminAgent.csrf(`${A}/dostawy`);
  await adminAgent.post(`${A}/dostawy/email/${id}/ponow`).type('form').send({ _csrf: token });
  await jobs.drain();
  assert.equal(h.conn().prepare('SELECT status FROM emails WHERE id = ?').get(id).status, 'sent');
});

test('walidacja kasy: e-mail, zgody i pułapka na boty', async () => {
  const { variant } = await createProduct(adminAgent, { name: 'Walidacja', price: '5,00', deliveryType: 'manual' });
  const c = h.agent(app);
  let token = await c.csrf('/zamowienie');
  await c.post('/koszyk/dodaj').type('form').send({ _csrf: token, variant_id: variant.id, qty: 1 });
  token = await c.csrf('/kasa');
  let res = await c.post('/kasa').type('form').send({ _csrf: token, email: 'zly', email2: 'zly', asset: 'BTC_TESTNET', terms: '1', withdrawal: '1' });
  assert.equal(res.status, 422);
  assert.match(res.text, /prawidłowy adres e-mail/);
  res = await c.post('/kasa').type('form').send({ _csrf: token, email: 'a@example.com', email2: 'b@example.com', asset: 'BTC_TESTNET', terms: '1', withdrawal: '1' });
  assert.match(res.text, /nie są identyczne/);
  res = await c.post('/kasa').type('form').send({ _csrf: token, email: 'a@example.com', email2: 'a@example.com', asset: 'BTC_TESTNET' });
  assert.match(res.text, /zaakceptować regulamin/);
  res = await c.post('/kasa').type('form').send({ _csrf: token, email: 'a@example.com', email2: 'a@example.com', asset: 'ETH', terms: '1', withdrawal: '1' });
  assert.match(res.text, /Wybierz kryptowalutę/, 'nieskonfigurowana sieć jest niedostępna');
  const n = h.conn().prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  res = await c.post('/kasa').type('form').send({ _csrf: token, email: 'a@example.com', email2: 'a@example.com', asset: 'BTC_TESTNET', terms: '1', withdrawal: '1', website: 'spam' });
  assert.equal(h.conn().prepare('SELECT COUNT(*) AS n FROM orders').get().n, n, 'bot nie utworzył zamówienia');
});

test('awaria API kursów: czytelny błąd zamiast zamówienia z błędną kwotą', async () => {
  const { variant } = await createProduct(adminAgent, { name: 'Bez kursu', price: '5,00', deliveryType: 'manual' });
  h.mock(/api\.coingecko\.com/, () => ({ status: 503, body: 'down' }));
  const c = h.agent(app);
  let token = await c.csrf('/zamowienie');
  await c.post('/koszyk/dodaj').type('form').send({ _csrf: token, variant_id: variant.id, qty: 1 });
  token = await c.csrf('/kasa');
  const res = await c.post('/kasa').type('form').send({ _csrf: token, email: 'k@example.com', email2: 'k@example.com', asset: 'BTC_TESTNET', terms: '1', withdrawal: '1' });
  assert.equal(res.status, 422);
  assert.match(res.text, /Kurs kryptowaluty jest chwilowo niedostępny/);
});

test('sieć EVM (USDT): unikalne kwoty, dopasowanie wpływu, nieprzypisany wpływ i przypisanie ręczne', async () => {
  const addr = '0x52908400098527886E0F7030069857D2E4169EE7';
  let head = 5000;
  const logs = [];
  h.mock(/publicnode\.com/, (url, opts) => {
    const body = JSON.parse(opts.body);
    const r = (result) => ({ jsonrpc: '2.0', id: body.id, result });
    if (body.method === 'eth_chainId') return r('0x1');
    if (body.method === 'eth_blockNumber') return r('0x' + head.toString(16));
    if (body.method === 'eth_call') return r('0x6');
    if (body.method === 'eth_getLogs') {
      const from = parseInt(body.params[0].fromBlock, 16);
      const to = parseInt(body.params[0].toBlock, 16);
      return r(logs.filter((l) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to));
    }
    if (body.method === 'eth_getTransactionReceipt') {
      const l = logs.find((x) => x.transactionHash === body.params[0]);
      return r(l ? { status: '0x1', logs: [{ ...l, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }] } : null);
    }
    throw new Error('nieobsługiwana metoda ' + body.method);
  });
  const token = await adminAgent.csrf(`${A}/ustawienia/platnosci`);
  await adminAgent.post(`${A}/ustawienia/platnosci/USDT_ERC20`).type('form').send({ _csrf: token, action: 'test', provider: 'direct', address: addr.toLowerCase(), confirmations: '3' });
  await adminAgent.post(`${A}/ustawienia/platnosci/USDT_ERC20`).type('form').send({ _csrf: token, action: 'enable' });
  const { variant } = await createProduct(adminAgent, { name: 'Token', price: '40,00', deliveryType: 'manual' });
  const o1 = await buy(variant.id, { email: 'u1@example.com', asset: 'USDT_ERC20' });
  const o2 = await buy(variant.id, { email: 'u2@example.com', asset: 'USDT_ERC20' });
  assert.notEqual(o1.payment.amount_atomic, o2.payment.amount_atomic, 'każde zamówienie ma unikalną kwotę');
  assert.ok(BigInt(o1.payment.amount_atomic) > 10_000_000n && BigInt(o1.payment.amount_atomic) < 10_010_000n, '40 zł / 4 zł = 10 USDT + końcówka');

  await tickAndDrain(); // inicjalizacja kursora
  const topicTo = '0x' + addr.toLowerCase().slice(2).padStart(64, '0');
  const log = (amount, n) => ({
    transactionHash: '0x' + crypto.sha256(`t${n}`), logIndex: '0x1', blockNumber: '0x' + (head + 1).toString(16), removed: false,
    data: '0x' + BigInt(amount).toString(16).padStart(64, '0'),
    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + '0'.repeat(64), topicTo],
  });
  logs.push(log(o1.payment.amount_atomic, 1));
  logs.push(log(9_000_000n, 2)); // wpływ z niepasującą kwotą
  head += 1;
  await tickAndDrain();
  assert.equal(h.conn().prepare('SELECT status FROM payments WHERE id = ?').get(o1.payment.id).status, 'confirming');
  head += 3;
  await tickAndDrain();
  assert.equal(h.conn().prepare('SELECT status FROM payments WHERE id = ?').get(o1.payment.id).status, 'paid');
  assert.equal(h.conn().prepare('SELECT status FROM payments WHERE id = ?').get(o2.payment.id).status, 'pending');
  const un = h.conn().prepare('SELECT * FROM unmatched_transfers').get();
  assert.ok(un, 'niepasujący wpływ trafił do kolejki ręcznej');
  // Administrator przypisuje go do zamówienia 2 -> niedopłata (9 z ~10 USDT)
  const t2 = await adminAgent.csrf(`${A}/platnosci`);
  await adminAgent.post(`${A}/platnosci/przypisz`).type('form').send({ _csrf: t2, unmatched_id: un.id, payment_id: o2.payment.id });
  await tickAndDrain();
  assert.equal(h.conn().prepare('SELECT status FROM payments WHERE id = ?').get(o2.payment.id).status, 'underpaid');
});

test('webhook NOWPayments: zły podpis odrzucony, dobry potwierdza przez API, duplikat ignorowany', async () => {
  settings.set('payments.nowpayments.api_key', 'np-key');
  settings.set('payments.nowpayments.ipn_secret', 'ipn-secret');
  let npStatus = 'waiting';
  h.mock(/api\.nowpayments\.io\/v1\/status/, () => ({ message: 'OK' }));
  h.mock(/api\.nowpayments\.io\/v1\/merchant\/coins/, () => ({ selectedCurrencies: ['ltc'] }));
  h.mock(/api\.nowpayments\.io\/v1\/payment$/, (url, opts) => {
    assert.equal(opts.headers['x-api-key'], 'np-key');
    return { payment_id: 777, pay_address: 'ltc1qnowpaymentsadres', pay_amount: 0.5, payment_status: 'waiting' };
  });
  h.mock(/api\.nowpayments\.io\/v1\/payment\/777/, () => ({ payment_id: 777, payment_status: npStatus, actually_paid: npStatus === 'finished' ? 0.5 : 0 }));
  const token = await adminAgent.csrf(`${A}/ustawienia/platnosci`);
  await adminAgent.post(`${A}/ustawienia/platnosci/LTC`).type('form').send({ _csrf: token, action: 'test', provider: 'nowpayments' });
  await adminAgent.post(`${A}/ustawienia/platnosci/LTC`).type('form').send({ _csrf: token, action: 'enable' });
  const { variant } = await createProduct(adminAgent, { name: 'NP produkt', price: '200,00' });
  await addKeys(adminAgent, variant.id, ['NP-KEY-1']);
  const { order, payment } = await buy(variant.id, { email: 'np@example.com', asset: 'LTC' });
  assert.equal(payment.provider_payment_id, '777');

  const body = { payment_id: 777, payment_status: 'finished', actually_paid: 0.5, order_id: order.public_id };
  const sign = (b, s) => require('crypto').createHmac('sha512', s).update(JSON.stringify(require('../src/services/payments/nowpayments').sortKeys(b))).digest('hex');
  let res = await h.request(app).post('/webhooks/nowpayments').set('x-nowpayments-sig', sign(body, 'zly')).send(body);
  assert.equal(res.status, 401);
  // Podpis poprawny, ale API mówi "waiting" -> nie oznaczamy jako opłacone (nie ufamy samej treści webhooka)
  res = await h.request(app).post('/webhooks/nowpayments').set('x-nowpayments-sig', sign(body, 'ipn-secret')).send(body);
  assert.equal(res.status, 200);
  assert.equal(h.conn().prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status, 'awaiting_payment');
  npStatus = 'finished';
  const body2 = { ...body, actually_paid: 0.50 + 0 };
  body2.payment_status = 'finished';
  body2.extra = 1;
  res = await h.request(app).post('/webhooks/nowpayments').set('x-nowpayments-sig', sign(body2, 'ipn-secret')).send(body2);
  assert.equal(res.status, 200);
  await jobs.drain();
  assert.equal(h.conn().prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status, 'fulfilled');
  res = await h.request(app).post('/webhooks/nowpayments').set('x-nowpayments-sig', sign(body2, 'ipn-secret')).send(body2);
  assert.equal(res.body.duplicate, true);
});

test('upload: plik udający obraz jest odrzucany', async () => {
  const token = await adminAgent.csrf(`${A}/produkty/nowy`);
  const res = await adminAgent.post(`${A}/produkty/nowy?_csrf=${token}`)
    .field('_csrf', token).field('name', 'Zły obraz').field('delivery_type', 'keys')
    .field('v_0_name', 'A').field('v_0_price', '1,00').field('v_0_active', '1')
    .attach('images', Buffer.from('<?php echo 1; ?>'), { filename: 'evil.png', contentType: 'image/png' });
  assert.equal(res.status, 422);
  assert.match(res.text, /nie jest prawidłowym obrazem/);
});

test('nagłówki bezpieczeństwa i brak wycieku ścieżki panelu w robots/stronach publicznych', async () => {
  const res = await h.request(app).get('/');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.doesNotMatch(res.text, new RegExp(`href="${A}`));
});
