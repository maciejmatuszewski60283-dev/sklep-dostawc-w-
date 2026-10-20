'use strict';
// Generowanie adresów odbiorczych BTC/LTC z publicznego klucza rozszerzonego (xpub/zpub/ypub...).
// Klucz prywatny NIGDY nie jest potrzebny ani przechowywany — sklep zna tylko klucz publiczny,
// więc nawet po włamaniu na serwer nikt nie wyda Twoich środków.
const { HDKey } = require('@scure/bip32');
const { base58check: makeB58c, bech32 } = require('@scure/base');
const { sha256 } = require('@noble/hashes/sha2.js');
const { ripemd160 } = require('@noble/hashes/legacy.js');

const b58c = makeB58c(sha256);

const NETS = {
  btc: {
    hrp: 'bc', p2pkh: 0x00, p2sh: 0x05,
    versions: { 0x0488b21e: 'xpub', 0x049d7cb2: 'ypub', 0x04b24746: 'zpub' },
  },
  'btc-test': {
    hrp: 'tb', p2pkh: 0x6f, p2sh: 0xc4,
    versions: { 0x043587cf: 'tpub', 0x044a5262: 'upub', 0x045f1cf6: 'vpub' },
  },
  ltc: {
    hrp: 'ltc', p2pkh: 0x30, p2sh: 0x32,
    versions: { 0x019da462: 'Ltub', 0x01b26ef6: 'Mtub', 0x0488b21e: 'xpub', 0x049d7cb2: 'ypub', 0x04b24746: 'zpub' },
  },
};

const IMPLIED_TYPE = { ypub: 'p2sh-p2wpkh', upub: 'p2sh-p2wpkh', Mtub: 'p2sh-p2wpkh', zpub: 'p2wpkh', vpub: 'p2wpkh' };

function hash160(buf) {
  return ripemd160(sha256(buf));
}

/** Analizuje klucz publiczny. Rzuca błąd z czytelnym komunikatem. */
function parseExtendedKey(str, netName, scriptTypeOverride = 'auto') {
  const net = NETS[netName];
  if (!net) throw new Error('Nieobsługiwana sieć');
  const s = String(str || '').trim();
  if (/^(xprv|yprv|zprv|tprv|uprv|vprv|Ltpv|Mtpv)/.test(s)) {
    throw new Error('To jest klucz PRYWATNY! Nigdy go nikomu nie podawaj. Wklej klucz publiczny (xpub/zpub).');
  }
  let raw;
  try {
    raw = b58c.decode(s);
  } catch {
    throw new Error('Niepoprawny klucz — sprawdź, czy skopiowałeś go w całości.');
  }
  if (raw.length !== 78) throw new Error('Niepoprawna długość klucza rozszerzonego.');
  const version = ((raw[0] << 24) | (raw[1] << 16) | (raw[2] << 8) | raw[3]) >>> 0;
  const prefix = net.versions[version];
  if (!prefix) throw new Error('Ten klucz nie pasuje do wybranej sieci (np. klucz testnet dla mainnetu).');
  const hd = HDKey.fromExtendedKey(s, { public: version, private: 0 });
  if (hd.privateKey) throw new Error('Klucz zawiera część prywatną — użyj klucza publicznego.');
  let scriptType = IMPLIED_TYPE[prefix];
  if (!scriptType) scriptType = scriptTypeOverride && scriptTypeOverride !== 'auto' ? scriptTypeOverride : 'p2wpkh';
  if (!['p2wpkh', 'p2sh-p2wpkh', 'p2pkh'].includes(scriptType)) throw new Error('Nieznany typ adresu');
  const fingerprint = Buffer.from(sha256(new TextEncoder().encode(s))).toString('hex').slice(0, 16);
  return { hd, scriptType, prefix, fingerprint, net };
}

function addressFromPubkey(pub, scriptType, net) {
  const h = hash160(pub);
  if (scriptType === 'p2wpkh') {
    return bech32.encode(net.hrp, [0, ...bech32.toWords(h)]);
  }
  if (scriptType === 'p2sh-p2wpkh') {
    const redeem = new Uint8Array([0x00, 0x14, ...h]);
    return b58c.encode(new Uint8Array([net.p2sh, ...hash160(redeem)]));
  }
  return b58c.encode(new Uint8Array([net.p2pkh, ...h]));
}

/** Adres odbiorczy nr `index` (ścieżka 0/index względem konta). */
function deriveAddress(parsed, index) {
  const child = parsed.hd.deriveChild(0).deriveChild(index);
  return addressFromPubkey(child.publicKey, parsed.scriptType, parsed.net);
}

module.exports = { parseExtendedKey, deriveAddress };
