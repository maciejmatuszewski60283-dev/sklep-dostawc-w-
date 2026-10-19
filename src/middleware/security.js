'use strict';
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const events = require('../lib/events');

function headers() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        ...(config.secureCookies ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.secureCookies ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  });
}

function limiter(name, { windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.isTest && !process.env.TEST_RATE_LIMITS,
    handler(req, res) {
      events.warn('security', 'rate_limited', `Przekroczony limit żądań (${name}) ${req.method} ${req.path}`, null, { ip: req.ip });
      res.status(429);
      if (req.accepts(['html', 'json']) === 'json') return res.json({ error: message });
      return res.render('shop/error', { title: 'Zbyt wiele żądań', message });
    },
  });
}

const limits = {
  global: limiter('global', { windowMs: 60 * 1000, limit: 300, message: 'Zbyt wiele żądań. Odczekaj chwilę.' }),
  search: limiter('search', { windowMs: 60 * 1000, limit: 60, message: 'Zbyt wiele wyszukiwań. Odczekaj chwilę.' }),
  cart: limiter('cart', { windowMs: 60 * 1000, limit: 60, message: 'Zbyt wiele operacji na koszyku.' }),
  checkout: limiter('checkout', { windowMs: 10 * 60 * 1000, limit: 10, message: 'Zbyt wiele prób złożenia zamówienia. Spróbuj za kilka minut.' }),
  orderStatus: limiter('order-status', { windowMs: 60 * 1000, limit: 40, message: 'Zbyt częste odświeżanie.' }),
  login: limiter('login', { windowMs: 15 * 60 * 1000, limit: 20, message: 'Zbyt wiele prób logowania. Spróbuj później.' }),
  webhook: limiter('webhook', { windowMs: 60 * 1000, limit: 120, message: 'Too many requests' }),
  admin: limiter('admin', { windowMs: 60 * 1000, limit: 240, message: 'Zbyt wiele żądań.' }),
};

module.exports = { headers, limits };
