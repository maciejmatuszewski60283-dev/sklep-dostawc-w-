'use strict';
// Odtwarzanie z kopii. Użycie: npm run restore -- backups/najtansze-itemki-XXXX.tar.gz
// ZATRZYMAJ SKLEP przed odtwarzaniem. Obecne dane zostaną przeniesione do data/pre-restore-<data>.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../src/config');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Podaj ścieżkę do pliku kopii: npm run restore -- <plik.tar.gz>');
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const work = fs.mkdtempSync(path.join(path.dirname(config.dataDir), '.restore-'));
try {
  execFileSync('tar', ['-xzf', path.resolve(file), '-C', work, '--no-same-owner']);
  if (!fs.existsSync(path.join(work, 'shop.db'))) throw new Error('W archiwum nie ma bazy danych shop.db');
  const keep = path.join(config.dataDir, `pre-restore-${stamp}`);
  fs.mkdirSync(keep, { recursive: true });
  for (const name of ['shop.db', 'shop.db-wal', 'shop.db-shm', 'uploads']) {
    const p = path.join(config.dataDir, name);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(keep, name));
  }
  if (fs.existsSync(path.join(config.dataDir, 'private', 'files'))) {
    fs.renameSync(path.join(config.dataDir, 'private', 'files'), path.join(keep, 'files'));
  }
  fs.mkdirSync(path.join(config.dataDir, 'private'), { recursive: true });
  fs.renameSync(path.join(work, 'shop.db'), config.dbFile);
  if (fs.existsSync(path.join(work, 'uploads'))) fs.renameSync(path.join(work, 'uploads'), path.join(config.dataDir, 'uploads'));
  if (fs.existsSync(path.join(work, 'private', 'files'))) fs.renameSync(path.join(work, 'private', 'files'), path.join(config.dataDir, 'private', 'files'));
  console.log('Odtworzono dane z kopii. Poprzednie dane zachowano w:', keep);
  console.log('Upewnij się, że ENCRYPTION_KEY w .env jest taki sam jak w chwili wykonania kopii, i uruchom sklep.');
} catch (e) {
  console.error('Błąd odtwarzania:', e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
