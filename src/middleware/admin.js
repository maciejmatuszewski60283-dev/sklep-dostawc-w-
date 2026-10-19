'use strict';
const db = require('../db');
const config = require('../config');
const { can } = require('../services/admin-auth');
const { parseDbDate } = require('../lib/util');

const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 12 * 3600 * 1000;

/** Wymaga pełnego zalogowania (hasło + 2FA). */
function requireAdmin(req, res, next) {
  const a = req.session.admin;
  const now = Date.now();
  const loginUrl = `${config.adminPath}/login`;
  if (!a || a.stage !== 'ok') {
    if (a && (a.stage === 'totp' || a.stage === 'totp_setup')) return res.redirect(`${config.adminPath}/2fa`);
    return res.redirect(loginUrl);
  }
  if (now - a.seenAt > IDLE_MS || now - a.authAt > ABSOLUTE_MS) {
    delete req.session.admin;
    return res.redirect(`${loginUrl}?wygasla=1`);
  }
  const user = db.get().prepare('SELECT id, username, email, role, active, password_changed_at, totp_enabled FROM admin_users WHERE id = ?').get(a.id);
  if (!user || !user.active || !user.totp_enabled || parseDbDate(user.password_changed_at).getTime() > a.authAt + 1000) {
    delete req.session.admin;
    return res.redirect(loginUrl);
  }
  a.seenAt = now;
  req.admin = user;
  res.locals.admin = user;
  res.locals.can = (perm) => can(user, perm);
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

function permit(perm) {
  return (req, res, next) => {
    if (can(req.admin, perm)) return next();
    res.status(403);
    return res.render('admin/error', { title: 'Brak uprawnień', message: 'Twoja rola nie ma dostępu do tej sekcji.' });
  };
}

module.exports = { requireAdmin, permit };
