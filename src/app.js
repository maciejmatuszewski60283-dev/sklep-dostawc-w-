'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const security = require('./middleware/security');
const session = require('./middleware/session');
const csrf = require('./middleware/csrf');
const settings = require('./lib/settings');
const money = require('./lib/money');
const util = require('./lib/util');
const events = require('./lib/events');
const cart = require('./services/cart');
const db = require('./db');

function assetVersion() {
  const h = crypto.createHash('sha1');
  for (const f of ['css/app.css', 'css/admin.css', 'js/app.js', 'js/admin.js']) {
    const p = path.join(config.root, 'public', f);
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
  }
  return h.digest('hex').slice(0, 10);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.root, 'views'));
  if (config.isProd) app.set('view cache', true);

  app.use(security.headers());
  app.get('/healthz', (req, res) => {
    try {
      db.get().prepare('SELECT 1').get();
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false });
    }
  });
  app.use(security.limits.global);

  const staticOpts = { maxAge: config.isProd ? '30d' : 0, immutable: config.isProd, index: false, fallthrough: true };
  app.use('/static', express.static(path.join(config.root, 'public'), staticOpts));
  app.use('/fonts/inter', express.static(path.join(config.root, 'node_modules/@fontsource-variable/inter/files'), staticOpts));
  app.use('/fonts/grotesk', express.static(path.join(config.root, 'node_modules/@fontsource-variable/space-grotesk/files'), staticOpts));
  app.use('/media', express.static(path.join(config.uploadsDir, 'products'), { ...staticOpts, dotfiles: 'deny' }));
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nDisallow: /zamowienie\nDisallow: /kasa\nDisallow: /koszyk\nDisallow: /pobierz\n`);
  });

  // Webhooki (bez sesji i CSRF — autoryzowane podpisem)
  app.use('/webhooks', security.limits.webhook, express.json({ limit: '64kb' }), require('./routes/webhooks'));

  app.use(express.urlencoded({ extended: false, limit: '256kb', parameterLimit: 2000 }));
  app.use(express.json({ limit: '32kb' }));
  app.use(session.middleware);
  app.use(csrf.provide);

  const version = assetVersion();
  app.use((req, res, next) => {
    res.locals.shop = settings.publicView();
    res.locals.money = money;
    res.locals.fmt = (minor) => money.formatMinor(minor, res.locals.shop.currency);
    res.locals.util = util;
    res.locals.v = version;
    res.locals.path = req.path;
    res.locals.query = req.query;
    res.locals.cartCount = cart.count(req.session);
    res.locals.flash = req.session.flash || null;
    if (req.session.flash) delete req.session.flash;
    req.flash = (type, message) => { req.session.flash = { type, message }; };
    next();
  });
  app.use(csrf.verify);

  app.use(config.adminPath, security.limits.admin, require('./routes/admin'));
  app.use(require('./routes/shop'));
  app.use(require('./routes/checkout'));
  app.use(require('./routes/order'));

  app.use((req, res) => {
    res.status(404).render('shop/error', { title: 'Nie znaleziono strony', message: 'Ta strona nie istnieje albo została przeniesiona.', code: 404 });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      events.error('system', 'http_error', `${req.method} ${req.path}: ${err.message}`, { stack: String(err.stack).slice(0, 800) }, { ip: req.ip });
    }
    if (res.headersSent) return;
    res.status(status);
    const message = status === 413 ? 'Przesłany plik lub formularz jest za duży.'
      : status < 500 ? 'Nieprawidłowe żądanie.' : 'Wystąpił błąd serwera. Spróbuj ponownie za chwilę.';
    if (req.accepts(['html', 'json']) === 'json') return res.json({ error: message });
    try {
      res.render('shop/error', { title: 'Błąd', message, code: status });
    } catch {
      res.type('text/plain').send(message);
    }
  });

  return app;
}

module.exports = { createApp };
