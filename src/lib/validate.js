'use strict';

// Rozsądna walidacja adresu e-mail (RFC 5322 jest zbyt liberalne do formularzy sklepowych)
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function email(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.length < 6 || s.length > 254) return null;
  if (!EMAIL_RE.test(s)) return null;
  const [local, domain] = s.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const tld = domain.split('.').pop();
  if (!/^[a-z]{2,24}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return null;
  return s;
}

function password(v) {
  const s = String(v || '');
  if (s.length < 12) return 'Hasło musi mieć co najmniej 12 znaków.';
  if (s.length > 200) return 'Hasło jest za długie.';
  if (/^(.)\1+$/.test(s)) return 'Hasło jest zbyt proste.';
  return null;
}

module.exports = { email, password };
