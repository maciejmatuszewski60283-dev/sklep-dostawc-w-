'use strict';
// Ochrona CSRF: token powiązany z losowym ciasteczkiem (podpis HMAC) + kontrola nagłówka Origin.
const config = require('../config');
const { randomToken, hmac, safeEqual } = require('../lib/crypto');
const { cookieString, appendCookie } = require('./session');
const events = require('../lib/events');

const COOKIE = config.secureCookies ? '__Host-csrf' : 'csrf';

function tokenFor(seed) {
  return hmac(`csrf:${seed}`).slice(0, 48);
}

function provide(req, res, next) {
  let seed = req.cookies[COOKIE];
  let token = null;
  res.locals.csrfToken = () => {
    if (token) return token;
    if (!seed || !/^[A-Za-z0-9_-]{32}$/.test(seed)) {
      seed = randomToken(24);
      appendCookie(res, cookieString(COOKIE, seed, { maxAge: 7 * 24 * 3600 * 1000 }));
    }
    token = tokenFor(seed);
    return token;
  };
  next();
}

function originOk(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true; // starsze przeglądarki — polegamy na tokenie
  try {
    const o = new URL(origin);
    const expected = new URL(config.publicUrl);
    return o.host === expected.host || o.host === req.headers.host;
  } catch {
    return false;
  }
}

function verify(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const seed = req.cookies[COOKIE];
  const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || req.query._csrf;
  if (!seed || !sent || !safeEqual(tokenFor(seed), sent) || !originOk(req)) {
    events.warn('security', 'csrf_failed', `Odrzucone żądanie (CSRF) ${req.method} ${req.path}`, null, { ip: req.ip });
    res.status(403);
    return res.render('shop/error', { title: 'Sesja wygasła', message: 'Formularz wygasł lub został wysłany z innej strony. Odśwież stronę i spróbuj ponownie.' });
  }
  next();
}

module.exports = { provide, verify };
