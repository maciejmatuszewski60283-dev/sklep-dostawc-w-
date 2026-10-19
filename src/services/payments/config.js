'use strict';
// Konfiguracja sieci płatności. Sieć jest dostępna dla klientów tylko gdy:
//  1) jest włączona, 2) przeszła test konfiguracji, 3) od testu nie zmieniono jej ustawień.
const settings = require('../../lib/settings');
const { sha256 } = require('../../lib/crypto');
const { ASSETS, defaultConfig } = require('./assets');

function get(code) {
  const asset = ASSETS[code];
  if (!asset) return null;
  return { ...defaultConfig(asset), ...(settings.getJson(`asset.${code}`, {}) || {}) };
}

function save(code, cfg) {
  settings.setJson(`asset.${code}`, cfg);
}

/** Odcisk istotnych pól konfiguracji — zmiana dowolnego z nich wymaga ponownego testu. */
function fingerprint(code, cfg) {
  const relevant = cfg.provider === 'nowpayments'
    ? ['nowpayments', settings.getBool('payments.nowpayments.sandbox') ? 'sandbox' : 'live']
    : [cfg.provider, cfg.xpub, cfg.scriptType, cfg.address, cfg.apiBase, cfg.rpc];
  return sha256(`${code}|${relevant.join('|')}`).slice(0, 32);
}

function isReady(code, cfg = get(code)) {
  return Boolean(cfg && cfg.enabled && cfg.verifiedAt && cfg.verifiedFingerprint === fingerprint(code, cfg));
}

/** Sieci dostępne w kasie. */
function enabledAssets() {
  return Object.values(ASSETS)
    .map((a) => ({ asset: a, cfg: get(a.code) }))
    .filter(({ asset, cfg }) => isReady(asset.code, cfg))
    .map(({ asset, cfg }) => ({ ...asset, cfg }));
}

module.exports = { get, save, fingerprint, isReady, enabledAssets };
