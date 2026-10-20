'use strict';
const express = require('express');
const config = require('../../config');
const settings = require('../../lib/settings');
const validate = require('../../lib/validate');
const { permit } = require('../../middleware/admin');
const email = require('../../services/email');
const payments = require('../../services/payments');
const pconfig = require('../../services/payments/config');
const { ASSETS } = require('../../services/payments/assets');
const { str, int, bool } = require('../../lib/util');

const router = express.Router();
const A = () => config.adminPath;

router.use('/ustawienia', permit('settings'));

router.get('/ustawienia', (req, res) => res.redirect(`${A()}/ustawienia/ogolne`));

// ---------------------------------------------------------------------------
// Ogólne
// ---------------------------------------------------------------------------

router.get('/ustawienia/ogolne', (req, res) => {
  res.render('admin/settings-general', { title: 'Ustawienia ogólne', s: settings });
});

router.post('/ustawienia/ogolne', (req, res) => {
  const b = req.body;
  const contact = str(b['shop.contact_email'], 200);
  if (contact && !validate.email(contact)) {
    req.flash('error', 'Nieprawidłowy e-mail kontaktowy.');
    return res.redirect(`${A()}/ustawienia/ogolne`);
  }
  settings.set('shop.name', str(b['shop.name'], 60) || 'najtańsze itemki');
  settings.set('shop.tagline', str(b['shop.tagline'], 200));
  settings.set('shop.currency', ['PLN', 'EUR', 'USD'].includes(b['shop.currency']) ? b['shop.currency'] : 'PLN');
  settings.set('shop.contact_email', contact);
  settings.set('shop.support_hours', str(b['shop.support_hours'], 100));
  settings.set('shop.announcement', str(b['shop.announcement'], 200));
  settings.set('home.hero_title', str(b['home.hero_title'], 120));
  settings.set('home.hero_subtitle', str(b['home.hero_subtitle'], 300));
  settings.set('checkout.payment_window_minutes', String(Math.min(180, Math.max(10, int(b['checkout.payment_window_minutes'], 30)))));
  settings.set('checkout.late_grace_hours', String(Math.min(168, Math.max(1, int(b['checkout.late_grace_hours'], 24)))));
  settings.set('checkout.max_pending_per_email', String(Math.min(20, Math.max(1, int(b['checkout.max_pending_per_email'], 3)))));
  settings.set('delivery.access_days', String(Math.min(365, Math.max(1, int(b['delivery.access_days'], 30)))));
  settings.set('stock.low_threshold', String(Math.min(1000, Math.max(0, int(b['stock.low_threshold'], 5)))));
  res.locals.audit('settings_general', 'Zmieniono ustawienia ogólne');
  req.flash('success', 'Zapisano ustawienia.');
  res.redirect(`${A()}/ustawienia/ogolne`);
});

// ---------------------------------------------------------------------------
// E-mail i powiadomienia
// ---------------------------------------------------------------------------

router.get('/ustawienia/email', (req, res) => {
  res.render('admin/settings-email', { title: 'E-mail i powiadomienia', s: settings });
});

router.post('/ustawienia/email', (req, res) => {
  const b = req.body;
  const from = str(b['email.from_address'], 200);
  const notify = str(b['notify.admin_email'], 200);
  if ((from && !validate.email(from)) || (notify && !validate.email(notify))) {
    req.flash('error', 'Nieprawidłowy adres e-mail.');
    return res.redirect(`${A()}/ustawienia/email`);
  }
  settings.set('email.from_name', str(b['email.from_name'], 80));
  settings.set('email.from_address', from);
  settings.set('email.smtp_host', str(b['email.smtp_host'], 200));
  settings.set('email.smtp_port', String(int(b['email.smtp_port'], 587)));
  settings.set('email.smtp_secure', bool(b['email.smtp_secure']) ? '1' : '0');
  settings.set('email.smtp_user', str(b['email.smtp_user'], 200));
  if (b['email.smtp_pass']) settings.set('email.smtp_pass', String(b['email.smtp_pass']).slice(0, 500));
  if (b.clear_smtp_pass === '1') settings.set('email.smtp_pass', '');
  settings.set('notify.admin_email', notify);
  for (const k of ['notify.on_paid', 'notify.on_out_of_stock', 'notify.on_delivery_failed']) settings.set(k, bool(b[k]) ? '1' : '0');
  res.locals.audit('settings_email', 'Zmieniono ustawienia e-mail');
  req.flash('success', 'Zapisano ustawienia e-mail.');
  res.redirect(`${A()}/ustawienia/email`);
});

router.post('/ustawienia/email/test', async (req, res) => {
  const to = validate.email(req.body.to);
  if (!to) {
    req.flash('error', 'Podaj prawidłowy adres odbiorcy testu.');
    return res.redirect(`${A()}/ustawienia/email`);
  }
  try {
    await email.sendTest(to);
    req.flash('success', `Wysłano wiadomość testową na ${to}. Sprawdź skrzynkę (również SPAM).`);
  } catch (e) {
    req.flash('error', `Wysyłka nie powiodła się: ${e.message}`);
  }
  res.redirect(`${A()}/ustawienia/email`);
});

// ---------------------------------------------------------------------------
// Płatności
// ---------------------------------------------------------------------------

router.get('/ustawienia/platnosci', (req, res) => {
  const assets = Object.values(ASSETS).map((a) => {
    const cfg = pconfig.get(a.code);
    return { asset: a, cfg, ready: pconfig.isReady(a.code, cfg), needsTest: cfg.verifiedAt && cfg.verifiedFingerprint !== pconfig.fingerprint(a.code, cfg) };
  });
  const report = req.session.assetTest || null;
  delete req.session.assetTest;
  res.render('admin/settings-payments', {
    title: 'Płatności', assets, report, s: settings, isProd: config.isProd,
    webhookUrl: `${config.publicUrl}/webhooks/nowpayments`,
  });
});

router.post('/ustawienia/platnosci/klucze', (req, res) => {
  const b = req.body;
  for (const k of ['payments.nowpayments.api_key', 'payments.nowpayments.ipn_secret', 'payments.etherscan_api_key', 'payments.trongrid_api_key']) {
    if (b[k]) settings.set(k, String(b[k]).trim().slice(0, 300));
    if (b[`clear_${k}`] === '1') settings.set(k, '');
  }
  settings.set('payments.nowpayments.sandbox', bool(b['payments.nowpayments.sandbox']) ? '1' : '0');
  res.locals.audit('settings_payment_keys', 'Zmieniono klucze API płatności');
  req.flash('success', 'Zapisano klucze. Sieci korzystające z tych usług wymagają ponownego testu, jeśli zmieniłeś tryb sandbox.');
  res.redirect(`${A()}/ustawienia/platnosci`);
});

function readAssetForm(code, body) {
  const asset = ASSETS[code];
  const prev = pconfig.get(code);
  const provider = asset.directOnly ? 'direct' : (body.provider === 'nowpayments' ? 'nowpayments' : 'direct');
  const httpsUrl = (v, def, previous) => {
    const s = str(v, 300);
    if (!s) return def || '';
    return /^https:\/\/[^\s]+$/.test(s) ? s.replace(/\/+$/, '') : previous;
  };
  return {
    ...prev,
    provider,
    xpub: str(body.xpub, 200),
    scriptType: ['auto', 'p2wpkh', 'p2sh-p2wpkh', 'p2pkh'].includes(body.scriptType) ? body.scriptType : 'auto',
    address: str(body.address, 100),
    confirmations: Math.min(500, Math.max(1, int(body.confirmations, asset.defaultConfirmations))),
    apiBase: httpsUrl(body.apiBase, asset.apiBase, prev.apiBase),
    rpc: httpsUrl(body.rpc, asset.rpc, prev.rpc),
  };
}

router.post('/ustawienia/platnosci/:code', async (req, res, next) => {
  const code = req.params.code;
  if (!ASSETS[code]) return next();
  const action = req.body.action;
  const cfg = readAssetForm(code, req.body);
  if (action === 'disable') {
    pconfig.save(code, { ...pconfig.get(code), enabled: false });
    res.locals.audit('asset_disabled', `Wyłączono płatności ${code}`);
    req.flash('success', `${code}: wyłączono. Klienci nie zobaczą tej metody w kasie.`);
    return res.redirect(`${A()}/ustawienia/platnosci#${code}`);
  }
  if (action === 'enable') {
    const current = pconfig.get(code);
    if (current.verifiedFingerprint !== pconfig.fingerprint(code, current)) {
      req.flash('error', 'Najpierw zapisz i przetestuj konfigurację.');
    } else {
      if (ASSETS[code].testnet && config.isProd) {
        req.flash('error', 'Sieć testowa nie może być włączona w środowisku produkcyjnym.');
        return res.redirect(`${A()}/ustawienia/platnosci#${code}`);
      }
      pconfig.save(code, { ...current, enabled: true });
      res.locals.audit('asset_enabled', `Włączono płatności ${code}`);
      req.flash('success', `${code}: włączono. Metoda jest dostępna w kasie.`);
    }
    return res.redirect(`${A()}/ustawienia/platnosci#${code}`);
  }
  // Zapis + test
  try {
    const report = await payments.testAsset(code, cfg);
    const fp = pconfig.fingerprint(code, cfg);
    // Zmiana adresu/klucza wyłącza sieć do czasu ponownego, świadomego włączenia
    const enabled = cfg.enabled && cfg.verifiedFingerprint === fp;
    pconfig.save(code, { ...cfg, enabled, verifiedAt: new Date().toISOString(), verifiedFingerprint: fp });
    req.session.assetTest = { code, ok: true, lines: report.lines, addresses: report.addresses };
    res.locals.audit('asset_tested', `Test konfiguracji ${code}: OK`);
  } catch (e) {
    pconfig.save(code, { ...cfg, enabled: false, verifiedAt: null, verifiedFingerprint: null });
    req.session.assetTest = { code, ok: false, lines: [e.message], addresses: [] };
    res.locals.audit('asset_test_failed', `Test konfiguracji ${code} nie powiódł się: ${e.message}`);
  }
  res.redirect(`${A()}/ustawienia/platnosci#${code}`);
});

module.exports = router;
