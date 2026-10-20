'use strict';
// DANE DEMONSTRACYJNE — tylko do lokalnych testów wyglądu i działania sklepu.
// Nie uruchamia się w produkcji. Produkty są ukryte etykietą „DEMO” w opisie.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../src/config');
const db = require('../src/db');
const delivery = require('../src/services/delivery');
const { randomToken } = require('../src/lib/crypto');
require('../src/services/seed').ensureBase();

if (config.isProd) {
  console.error('seed:demo nie może być uruchomiony w środowisku produkcyjnym.');
  process.exit(1);
}

const DEMO = [
  { name: 'Steam Wallet — doładowanie', platform: 'steam', category: 'gry', c1: '#1b2838', c2: '#66c0f4', label: 'STEAM\nWALLET',
    variants: [['20 zł', 1899, 2000], ['50 zł', 4690, 5000], ['100 zł', 9290, null]], featured: 1 },
  { name: 'PlayStation Store — karta 100 zł', platform: 'playstation', category: 'gry', c1: '#0b1c4d', c2: '#4b7bec', label: 'PS\nSTORE',
    variants: [['100 zł', 9490, 9999]], featured: 1 },
  { name: 'Xbox Game Pass Ultimate — 1 miesiąc', platform: 'xbox', category: 'gry', c1: '#0e3b17', c2: '#3ec46d', label: 'GAME\nPASS',
    variants: [['1 miesiąc', 5990, 6999], ['3 miesiące', 16990, null]], featured: 1 },
  { name: 'Minecraft: Java & Bedrock Edition', platform: 'minecraft', category: 'gry', c1: '#2d4a1e', c2: '#7bc96f', label: 'MINE\nCRAFT',
    variants: [['PC — Global', 8990, 11900]], featured: 1 },
  { name: 'Roblox — karta 800 Robux', platform: 'roblox', category: 'gry', c1: '#222', c2: '#e8e8e8', label: '800\nROBUX',
    variants: [['800 Robux', 3990, null], ['2000 Robux', 9490, null]] },
  { name: 'Nintendo eShop — 100 zł', platform: 'nintendo', category: 'gry', c1: '#5a0d12', c2: '#ff5a5f', label: 'NINTENDO\neSHOP',
    variants: [['100 zł', 9590, null]] },
  { name: 'Windows 11 Pro — licencja', platform: 'windows', category: 'gry', c1: '#00243a', c2: '#00a4ef', label: 'WIN 11\nPRO',
    variants: [['Licencja', 4990, 7990]], featured: 1 },
  { name: 'Battle.net — 20 EUR', platform: 'battle-net', category: 'gry', c1: '#0a2540', c2: '#3fa9f5', label: 'BATTLE\n.NET',
    variants: [['20 EUR', 8790, null]] },
];

async function cover(d) {
  const lines = d.label.split('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.c1}"/><stop offset="1" stop-color="${d.c2}"/></linearGradient>
    <radialGradient id="r" cx=".8" cy=".2" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="1200" height="900" fill="url(#g)"/><rect width="1200" height="900" fill="url(#r)"/>
    <g fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2">${Array.from({ length: 12 }, (_, i) => `<circle cx="1000" cy="150" r="${80 + i * 70}"/>`).join('')}</g>
    ${lines.map((l, i) => `<text x="90" y="${560 + i * 150 - (lines.length - 1) * 75}" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="150" fill="#fff" letter-spacing="-6">${l.replace(/&/g, '&amp;')}</text>`).join('')}
    <rect x="90" y="760" width="190" height="10" rx="5" fill="#c6f432"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

(async () => {
  const conn = db.get();
  const dir = path.join(config.uploadsDir, 'products');
  fs.mkdirSync(dir, { recursive: true });
  const images = require('../src/lib/images');
  for (const [i, d] of DEMO.entries()) {
    const slug = require('../src/lib/util').slugify(d.name);
    if (conn.prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) continue;
    const pl = conn.prepare('SELECT id FROM platforms WHERE slug = ?').get(d.platform);
    const cat = conn.prepare('SELECT id FROM categories WHERE slug = ?').get(d.category);
    const pid = conn.prepare(`INSERT INTO products (slug, name, short_description, description_md, category_id, platform_id, region, delivery_type,
      delivery_info_md, requirements_md, rights_confirmed, active, featured, sort) VALUES (?,?,?,?,?,?,?, 'keys', ?, ?, 1, 1, ?, ?)`).run(
      slug, d.name, 'Produkt demonstracyjny — kod dostarczany automatycznie.',
      `**PRODUKT DEMONSTRACYJNY** (dane testowe, usuń przed startem sklepu).\n\n${d.name} — kod cyfrowy dostarczany automatycznie po potwierdzeniu płatności w kryptowalucie.\n\n- Natychmiastowa dostawa\n- Bezpieczny odbiór na stronie zamówienia\n- Obsługa klienta po polsku`,
      cat ? cat.id : null, pl ? pl.id : null, 'Global', 'Aktywuj kod w aplikacji platformy.', 'Wymaga konta na platformie.', d.featured || 0, i
    ).lastInsertRowid;
    const img = await images.processProductImage(await cover(d));
    conn.prepare('INSERT INTO product_images (product_id, file, thumb, width, height, sort) VALUES (?,?,?,?,?,0)').run(pid, img.file, img.thumb, img.width, img.height);
    d.variants.forEach(([name, price, cmp], vi) => {
      const vid = conn.prepare('INSERT INTO variants (product_id, name, price_minor, compare_at_minor, active, sort) VALUES (?,?,?,?,1,?)').run(pid, name, price, cmp, vi).lastInsertRowid;
      conn.prepare("INSERT INTO price_history (variant_id, price_minor, changed_at) VALUES (?,?, datetime('now','-40 days'))").run(vid, cmp || price);
      if (cmp) conn.prepare("INSERT INTO price_history (variant_id, price_minor, changed_at) VALUES (?,?, datetime('now','-2 days'))").run(vid, price);
      const n = i === 5 ? 0 : i === 4 ? 2 : 25;
      delivery.addStock(vid, Array.from({ length: n }, () => `DEMO-${randomToken(9).toUpperCase().replace(/[^A-Z0-9]/g, 'X').match(/.{1,4}/g).join('-')}`).join('\n'));
    });
    console.log('Dodano:', d.name);
  }
  console.log('Gotowe. Dane demonstracyjne służą tylko do testów lokalnych.');
})().catch((e) => { console.error(e); process.exit(1); });
