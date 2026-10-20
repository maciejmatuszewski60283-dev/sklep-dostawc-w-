'use strict';
// Kopia zapasowa: spójna kopia bazy (bez zatrzymywania sklepu) + zdjęcia + pliki do dostawy.
// Użycie: npm run backup [-- katalog_docelowy]
// Wynik: backups/najtansze-itemki-RRRRMMDD-GGMMSS.tar.gz
// UWAGA: kopia zawiera zaszyfrowane klucze produktów. Klucz ENCRYPTION_KEY przechowuj OSOBNO.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../src/config');
const db = require('../src/db');

(async () => {
  const outDir = path.resolve(process.argv[2] || path.join(config.root, 'backups'));
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const work = fs.mkdtempSync(path.join(outDir, '.tmp-'));
  try {
    await db.get().backup(path.join(work, 'shop.db'));
    for (const dir of ['uploads', 'private/files']) {
      const src = path.join(config.dataDir, dir);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(work, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(work, 'BACKUP_INFO.txt'), `Kopia sklepu najtańsze itemki\nData: ${new Date().toISOString()}\nOdtwarzanie: npm run restore -- <plik.tar.gz>\n`);
    const file = path.join(outDir, `najtansze-itemki-${stamp}.tar.gz`);
    execFileSync('tar', ['-czf', file, '-C', work, '.']);
    fs.chmodSync(file, 0o600);
    console.log(`Kopia zapisana: ${file}`);
    // Zostaw 14 najnowszych kopii
    const all = fs.readdirSync(outDir).filter((f) => /^najtansze-itemki-.*\.tar\.gz$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.rmSync(path.join(outDir, old));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    db.get().close();
  }
})().catch((e) => {
  console.error('Błąd kopii zapasowej:', e.message);
  process.exit(1);
});
