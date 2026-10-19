'use strict';
// Tworzy konto właściciela panelu. Użycie: npm run admin:create
const readline = require('readline');
const db = require('../src/db');
const auth = require('../src/services/admin-auth');
const config = require('../src/config');
require('../src/services/seed').ensureBase();

function ask(rl, q, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(q, resolve);
    const out = rl.output;
    rl.output = { write: () => {} };
    out.write(q);
    rl.question('', (a) => { rl.output = out; out.write('\n'); resolve(a); });
  });
}

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    const username = process.env.ADMIN_USERNAME || await ask(rl, 'Login administratora: ');
    const password = process.env.ADMIN_PASSWORD || await ask(rl, 'Hasło (min. 12 znaków): ', true);
    if (!process.env.ADMIN_PASSWORD) {
      const again = await ask(rl, 'Powtórz hasło: ', true);
      if (again !== password) throw new Error('Hasła nie są identyczne.');
    }
    auth.createUser({ username, password, role: 'owner' });
    console.log(`\nUtworzono konto właściciela "${username}".`);
    console.log(`Zaloguj się: ${config.publicUrl}${config.adminPath}/login — przy pierwszym logowaniu skonfigurujesz 2FA.`);
  } catch (e) {
    console.error(`Błąd: ${e.message.includes('UNIQUE') ? 'taki login już istnieje' : e.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
    db.get().close();
  }
})();
