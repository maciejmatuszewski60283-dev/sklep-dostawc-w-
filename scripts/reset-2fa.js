'use strict';
// Awaryjny reset 2FA (np. zgubiony telefon i kody odzyskiwania). Użycie: npm run admin:reset-2fa -- <login>
const db = require('../src/db');
const events = require('../src/lib/events');

const username = process.argv[2];
if (!username) {
  console.error('Podaj login: npm run admin:reset-2fa -- <login>');
  process.exit(1);
}
const r = db.get().prepare("UPDATE admin_users SET totp_enabled = 0, totp_secret_enc = NULL, recovery_codes = '[]', password_changed_at = datetime('now') WHERE username = ?").run(username);
if (!r.changes) {
  console.error('Nie znaleziono takiego użytkownika.');
  process.exit(1);
}
events.warn('security', '2fa_reset_cli', `Zresetowano 2FA z konsoli serwera (${username})`);
console.log(`Zresetowano 2FA dla "${username}". Przy następnym logowaniu skonfiguruj je ponownie.`);
