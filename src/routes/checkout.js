'use strict';
const express = require('express');
const cart = require('../services/cart');
const orders = require('../services/orders');
const pconfig = require('../services/payments/config');
const validate = require('../lib/validate');
const events = require('../lib/events');
const { limits } = require('../middleware/security');
const db = require('../db');

const router = express.Router();

router.use('/kasa', (req, res, next) => {
  res.locals.footerPages = db.get().prepare('SELECT slug, title FROM pages WHERE show_in_footer = 1 ORDER BY sort, title').all();
  res.set('Cache-Control', 'no-store');
  next();
});

function renderCheckout(req, res, extra = {}) {
  const summary = cart.summary(req.session);
  if (!summary.items.length) return res.redirect('/koszyk');
  res.render('shop/checkout', {
    title: 'Kasa',
    summary,
    assets: pconfig.enabledAssets(),
    form: extra.form || { email: '', email2: '', asset: '' },
    errors: extra.errors || {},
    error: extra.error || null,
  });
}

router.get('/kasa', (req, res) => renderCheckout(req, res));

router.post('/kasa', limits.checkout, async (req, res, next) => {
  try {
    const form = {
      email: String(req.body.email || '').trim(),
      email2: String(req.body.email2 || '').trim(),
      asset: String(req.body.asset || ''),
    };
    // Pułapka na boty: ukryte pole, którego człowiek nie wypełni
    if (req.body.website) {
      events.warn('security', 'honeypot', 'Wykryto automatyczne wysłanie formularza zamówienia', null, { ip: req.ip });
      return renderCheckout(req, res, { form, error: 'Nie udało się złożyć zamówienia.' });
    }
    const errors = {};
    const email = validate.email(form.email);
    if (!email) errors.email = 'Podaj prawidłowy adres e-mail.';
    else if (email !== String(form.email2).trim().toLowerCase()) errors.email2 = 'Adresy e-mail nie są identyczne.';
    const assets = pconfig.enabledAssets();
    if (!assets.some((a) => a.code === form.asset)) errors.asset = 'Wybierz kryptowalutę i sieć.';
    if (req.body.terms !== '1') errors.terms = 'Musisz zaakceptować regulamin.';
    if (req.body.withdrawal !== '1') errors.withdrawal = 'Ta zgoda jest wymagana do natychmiastowej dostawy produktu cyfrowego.';
    if (Object.keys(errors).length) {
      res.status(422);
      return renderCheckout(req, res, { form, errors });
    }
    const result = await orders.createFromCart(req.session, { email, assetCode: form.asset, ip: req.ip });
    if (result.error) {
      res.status(422);
      return renderCheckout(req, res, { form, error: result.error });
    }
    req.session.orders = { ...(req.session.orders || {}), [result.order.public_id]: Date.now() };
    return res.redirect(`/zamowienie/${result.order.public_id}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
