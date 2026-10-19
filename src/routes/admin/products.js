'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../../db');
const config = require('../../config');
const { permit } = require('../../middleware/admin');
const images = require('../../lib/images');
const money = require('../../lib/money');
const crypto = require('../../lib/crypto');
const delivery = require('../../services/delivery');
const { slugify, int, str, bool, escapeLike } = require('../../lib/util');

const router = express.Router();
const tmpDir = path.join(config.privateDir, 'tmp');
const filesDir = path.join(config.privateDir, 'files');

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename(req, file, cb) {
      cb(null, crypto.randomToken(16));
    },
  }),
  limits: { fileSize: Math.max(10, config.maxDeliveryFileMb) * 1024 * 1024, files: 11, fields: 400 },
});

function cleanupTmp(req) {
  const all = Object.values(req.files || {}).flat();
  for (const f of all) fs.rm(f.path, { force: true }, () => {});
}

const A = () => config.adminPath;

// ---------------------------------------------------------------------------
// Lista produktów
// ---------------------------------------------------------------------------

router.get('/produkty', permit('products'), (req, res) => {
  const q = str(req.query.q, 100);
  const status = str(req.query.status, 20);
  const where = ['p.deleted_at IS NULL'];
  const params = [];
  if (q) { where.push("p.name LIKE ? ESCAPE '\\'"); params.push(`%${escapeLike(q)}%`); }
  if (status === 'active') where.push('p.active = 1');
  if (status === 'hidden') where.push('p.active = 0');
  const rows = db.get().prepare(`SELECT p.*, c.name AS category_name, pl.name AS platform_name,
      (SELECT thumb FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS thumb,
      (SELECT MIN(price_minor) FROM variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS min_price,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS variant_count,
      (SELECT COUNT(*) FROM stock_items s JOIN variants v ON v.id = s.variant_id WHERE v.product_id = p.id AND s.status = 'available' AND v.deleted_at IS NULL) AS stock
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN platforms pl ON pl.id = p.platform_id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 500`).all(...params);
  res.render('admin/products', { title: 'Produkty', rows, q, status });
});

// ---------------------------------------------------------------------------
// Formularz produktu
// ---------------------------------------------------------------------------

function formData(product) {
  const conn = db.get();
  return {
    categories: conn.prepare('SELECT * FROM categories ORDER BY sort, name').all(),
    platforms: conn.prepare('SELECT * FROM platforms ORDER BY sort, name').all(),
    images: product ? conn.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, id').all(product.id) : [],
    variants: product ? conn.prepare(`SELECT v.*, (SELECT COUNT(*) FROM stock_items s WHERE s.variant_id = v.id AND s.status='available') AS stock
      FROM variants v WHERE v.product_id = ? AND v.deleted_at IS NULL ORDER BY v.sort, v.id`).all(product.id) : [],
    deliveryFile: product && product.delivery_file_id ? conn.prepare('SELECT * FROM delivery_files WHERE id = ?').get(product.delivery_file_id) : null,
  };
}

router.get('/produkty/nowy', permit('products'), (req, res) => {
  res.render('admin/product-form', { title: 'Dodaj produkt', product: null, errors: [], form: null, ...formData(null) });
});

router.get('/produkty/:id', permit('products'), (req, res, next) => {
  const product = db.get().prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(int(req.params.id));
  if (!product) return next();
  res.render('admin/product-form', { title: `Edycja: ${product.name}`, product, errors: [], form: null, ...formData(product) });
});

/** Odczyt wierszy wariantów z formularza (pola v_<n>_<pole>). */
function parseVariants(body) {
  const map = new Map();
  for (const [k, val] of Object.entries(body)) {
    const m = /^v_(\d{1,3})_(id|name|price|compare|stock|active|sort)$/.exec(k);
    if (!m) continue;
    if (!map.has(m[1])) map.set(m[1], {});
    map.get(m[1])[m[2]] = Array.isArray(val) ? val[val.length - 1] : val;
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    .filter((v) => str(v.name) || str(v.price) || v.id);
}

function validateProduct(body, variants) {
  const errors = [];
  const name = str(body.name, 160);
  if (name.length < 2) errors.push('Podaj nazwę produktu.');
  if (!['keys', 'file', 'manual'].includes(body.delivery_type)) errors.push('Wybierz sposób dostawy.');
  if (!variants.length) errors.push('Dodaj co najmniej jeden wariant z ceną.');
  variants.forEach((v, i) => {
    if (!str(v.name, 120)) errors.push(`Wariant ${i + 1}: podaj nazwę (np. „Standard” lub „50 zł”).`);
    if (money.parseMinor(v.price) == null) errors.push(`Wariant ${i + 1}: nieprawidłowa cena.`);
    if (str(v.compare) && money.parseMinor(v.compare) == null) errors.push(`Wariant ${i + 1}: nieprawidłowa cena przed obniżką.`);
    if (str(v.stock) && !/^\d{1,7}$/.test(str(v.stock))) errors.push(`Wariant ${i + 1}: stan musi być liczbą całkowitą.`);
  });
  if (bool(body.active) && !bool(body.rights_confirmed)) {
    errors.push('Aby opublikować produkt, potwierdź, że masz prawo do jego dystrybucji.');
  }
  return errors;
}

function uniqueSlug(base, excludeId) {
  let slug = slugify(base);
  let i = 2;
  while (db.get().prepare('SELECT 1 FROM products WHERE slug = ? AND id != ?').get(slug, excludeId || 0)) slug = `${slugify(base)}-${i++}`;
  return slug;
}

async function saveProduct(req, res, existing) {
  const body = req.body;
  const variants = parseVariants(body);
  const errors = validateProduct(body, variants);
  const imageFiles = (req.files && req.files.images) || [];
  const deliveryUpload = req.files && req.files.delivery_file && req.files.delivery_file[0];
  if (body.delivery_type === 'file' && !deliveryUpload && !(existing && existing.delivery_file_id)) {
    errors.push('Dla dostawy „plik” wgraj plik, który otrzyma klient.');
  }
  for (const f of imageFiles) if (f.size > 10 * 1024 * 1024) errors.push(`Zdjęcie ${f.originalname} jest większe niż 10 MB.`);

  // Przetwarzanie zdjęć (walidacja treści pliku przez bibliotekę graficzną)
  const processed = [];
  if (!errors.length) {
    for (const f of imageFiles.slice(0, 10)) {
      try {
        processed.push(await images.processProductImage(fs.readFileSync(f.path)));
      } catch (e) {
        errors.push(`${f.originalname}: ${e.message}`);
      }
    }
  }
  if (errors.length) {
    processed.forEach(images.removeImageFiles);
    cleanupTmp(req);
    res.status(422);
    return res.render('admin/product-form', {
      title: existing ? `Edycja: ${existing.name}` : 'Dodaj produkt', product: existing, errors, form: { ...body, variants }, ...formData(existing),
    });
  }

  const conn = db.get();
  let deliveryFileId = existing ? existing.delivery_file_id : null;
  if (deliveryUpload) {
    fs.mkdirSync(filesDir, { recursive: true, mode: 0o750 });
    const stored = crypto.randomToken(18);
    const buf = fs.readFileSync(deliveryUpload.path);
    fs.renameSync(deliveryUpload.path, path.join(filesDir, stored));
    const safeName = path.basename(deliveryUpload.originalname).replace(/[^\w.\- ()ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, '_').slice(0, 120) || 'plik';
    deliveryFileId = conn.prepare('INSERT INTO delivery_files (original_name, stored_name, size, sha256) VALUES (?,?,?,?)')
      .run(safeName, stored, deliveryUpload.size, crypto.sha256(buf)).lastInsertRowid;
  }

  const fields = {
    name: str(body.name, 160),
    short_description: str(body.short_description, 300),
    description_md: str(body.description_md, 20000),
    category_id: int(body.category_id) || null,
    platform_id: int(body.platform_id) || null,
    region: str(body.region, 80),
    delivery_type: body.delivery_type,
    delivery_file_id: deliveryFileId,
    delivery_info_md: str(body.delivery_info_md, 5000),
    requirements_md: str(body.requirements_md, 5000),
    rights_confirmed: bool(body.rights_confirmed) ? 1 : 0,
    active: bool(body.active) ? 1 : 0,
    featured: bool(body.featured) ? 1 : 0,
    sort: int(body.sort, 0),
  };

  const productId = conn.transaction(() => {
    let id;
    if (existing) {
      id = existing.id;
      const slug = str(body.slug) ? uniqueSlug(body.slug, id) : existing.slug;
      conn.prepare(`UPDATE products SET slug=@slug, name=@name, short_description=@short_description, description_md=@description_md,
        category_id=@category_id, platform_id=@platform_id, region=@region, delivery_type=@delivery_type, delivery_file_id=@delivery_file_id,
        delivery_info_md=@delivery_info_md, requirements_md=@requirements_md, rights_confirmed=@rights_confirmed, active=@active,
        featured=@featured, sort=@sort, updated_at=datetime('now') WHERE id=@id`).run({ ...fields, slug, id });
    } else {
      id = conn.prepare(`INSERT INTO products (slug, name, short_description, description_md, category_id, platform_id, region, delivery_type,
        delivery_file_id, delivery_info_md, requirements_md, rights_confirmed, active, featured, sort)
        VALUES (@slug, @name, @short_description, @description_md, @category_id, @platform_id, @region, @delivery_type, @delivery_file_id,
        @delivery_info_md, @requirements_md, @rights_confirmed, @active, @featured, @sort)`).run({ ...fields, slug: uniqueSlug(str(body.slug) || fields.name) }).lastInsertRowid;
    }
    // Warianty
    const keep = new Set();
    variants.forEach((v, i) => {
      const price = money.parseMinor(v.price);
      const compare = str(v.compare) ? money.parseMinor(v.compare) : null;
      const manualStock = str(v.stock) ? parseInt(v.stock, 10) : null;
      const active = v.active === '1' || v.active === 'on' ? 1 : 0;
      const vid = int(v.id);
      const own = vid && conn.prepare('SELECT * FROM variants WHERE id = ? AND product_id = ? AND deleted_at IS NULL').get(vid, id);
      if (own) {
        conn.prepare('UPDATE variants SET name=?, price_minor=?, compare_at_minor=?, manual_stock=?, active=?, sort=? WHERE id=?')
          .run(str(v.name, 120), price, compare, manualStock, active, i, vid);
        if (own.price_minor !== price) conn.prepare('INSERT INTO price_history (variant_id, price_minor) VALUES (?,?)').run(vid, price);
        keep.add(vid);
      } else {
        const nid = conn.prepare('INSERT INTO variants (product_id, name, price_minor, compare_at_minor, manual_stock, active, sort) VALUES (?,?,?,?,?,?,?)')
          .run(id, str(v.name, 120), price, compare, manualStock, active, i).lastInsertRowid;
        conn.prepare('INSERT INTO price_history (variant_id, price_minor) VALUES (?,?)').run(nid, price);
        keep.add(nid);
      }
    });
    // Usunięte warianty: miękkie usunięcie (zachowuje historię zamówień); niesprzedane klucze wycofujemy
    for (const old of conn.prepare('SELECT id FROM variants WHERE product_id = ? AND deleted_at IS NULL').all(id)) {
      if (!keep.has(old.id)) {
        conn.prepare("UPDATE variants SET deleted_at = datetime('now'), active = 0 WHERE id = ?").run(old.id);
        conn.prepare("UPDATE stock_items SET status = 'removed' WHERE variant_id = ? AND status = 'available'").run(old.id);
      }
    }
    // Zdjęcia
    const maxSort = conn.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM product_images WHERE product_id = ?').get(id).m;
    processed.forEach((img, i) => {
      conn.prepare('INSERT INTO product_images (product_id, file, thumb, width, height, sort) VALUES (?,?,?,?,?,?)').run(id, img.file, img.thumb, img.width, img.height, maxSort + 1 + i);
    });
    return id;
  })();
  cleanupTmp(req);
  res.locals.audit(existing ? 'product_updated' : 'product_created', `${existing ? 'Zmieniono' : 'Dodano'} produkt „${fields.name}”`, { productId });
  req.flash('success', existing ? 'Zapisano zmiany.' : 'Produkt został dodany.');
  return res.redirect(`${A()}/produkty/${productId}`);
}

const productUpload = upload.fields([{ name: 'images', maxCount: 10 }, { name: 'delivery_file', maxCount: 1 }]);

router.post('/produkty/nowy', permit('products'), productUpload, (req, res, next) => saveProduct(req, res, null).catch((e) => { cleanupTmp(req); next(e); }));

router.post('/produkty/:id', permit('products'), productUpload, (req, res, next) => {
  const product = db.get().prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(int(req.params.id));
  if (!product) { cleanupTmp(req); return next(); }
  return saveProduct(req, res, product).catch((e) => { cleanupTmp(req); next(e); });
});

router.post('/produkty/:id/widocznosc', permit('products'), (req, res) => {
  const p = db.get().prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(int(req.params.id));
  if (p) {
    if (!p.active && !p.rights_confirmed) {
      req.flash('error', 'Najpierw potwierdź w edycji produktu, że masz prawo do jego dystrybucji.');
    } else {
      db.get().prepare("UPDATE products SET active = ?, updated_at = datetime('now') WHERE id = ?").run(p.active ? 0 : 1, p.id);
      res.locals.audit('product_visibility', `${p.active ? 'Ukryto' : 'Opublikowano'} produkt „${p.name}”`, { productId: p.id });
    }
  }
  res.redirect(`${A()}/produkty`);
});

router.post('/produkty/:id/usun', permit('products'), (req, res) => {
  const p = db.get().prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(int(req.params.id));
  if (p) {
    db.get().transaction(() => {
      db.get().prepare("UPDATE products SET deleted_at = datetime('now'), active = 0, slug = slug || '-usuniety-' || id WHERE id = ?").run(p.id);
      db.get().prepare("UPDATE stock_items SET status='removed' WHERE status='available' AND variant_id IN (SELECT id FROM variants WHERE product_id = ?)").run(p.id);
    })();
    res.locals.audit('product_deleted', `Usunięto produkt „${p.name}”`, { productId: p.id });
    req.flash('success', `Usunięto produkt „${p.name}”. Historia zamówień została zachowana.`);
  }
  res.redirect(`${A()}/produkty`);
});

router.post('/produkty/:id/zdjecia/:img/usun', permit('products'), (req, res) => {
  const img = db.get().prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(int(req.params.img), int(req.params.id));
  if (img) {
    db.get().prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
    images.removeImageFiles(img);
  }
  res.redirect(`${A()}/produkty/${int(req.params.id)}#zdjecia`);
});

router.post('/produkty/:id/zdjecia/:img/glowne', permit('products'), (req, res) => {
  const conn = db.get();
  const pid = int(req.params.id);
  const img = conn.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(int(req.params.img), pid);
  if (img) {
    conn.transaction(() => {
      conn.prepare('UPDATE product_images SET sort = sort + 1 WHERE product_id = ?').run(pid);
      conn.prepare('UPDATE product_images SET sort = 0 WHERE id = ?').run(img.id);
    })();
  }
  res.redirect(`${A()}/produkty/${pid}#zdjecia`);
});

// ---------------------------------------------------------------------------
// Magazyn (klucze / kody)
// ---------------------------------------------------------------------------

router.get('/magazyn', permit('stock'), (req, res) => {
  const rows = db.get().prepare(`SELECT v.id, v.name, p.id AS product_id, p.name AS product_name, p.delivery_type, v.manual_stock,
      (SELECT COUNT(*) FROM stock_items s WHERE s.variant_id = v.id AND s.status='available') AS available,
      (SELECT COUNT(*) FROM stock_items s WHERE s.variant_id = v.id AND s.status='sold') AS sold
    FROM variants v JOIN products p ON p.id = v.product_id
    WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY p.name, v.sort`).all();
  res.render('admin/stock', { title: 'Magazyn', rows });
});

router.get('/magazyn/:variantId', permit('stock'), (req, res, next) => {
  const conn = db.get();
  const v = conn.prepare(`SELECT v.*, p.name AS product_name, p.delivery_type FROM variants v JOIN products p ON p.id = v.product_id
    WHERE v.id = ? AND v.deleted_at IS NULL`).get(int(req.params.variantId));
  if (!v) return next();
  const items = conn.prepare(`SELECT s.id, s.status, s.created_at, s.sold_at, s.content_enc, o.public_id
    FROM stock_items s LEFT JOIN order_items oi ON oi.id = s.order_item_id LEFT JOIN orders o ON o.id = oi.order_id
    WHERE s.variant_id = ? AND s.status != 'removed' ORDER BY s.status = 'available' DESC, s.id DESC LIMIT 500`).all(v.id)
    .map((s) => {
      // W panelu pokazujemy tylko fragment klucza (pełna treść dostępna wyłącznie dla klienta)
      let preview = '••••';
      try {
        const c = crypto.decrypt(s.content_enc);
        preview = c.length > 8 ? `${c.slice(0, 4)}…${c.slice(-3)}` : '••••';
      } catch { /* ignore */ }
      return { ...s, preview, content_enc: undefined };
    });
  res.render('admin/stock-variant', { title: `Magazyn: ${v.product_name}`, v, items, result: null });
});

router.post('/magazyn/:variantId/dodaj', permit('stock'), (req, res, next) => {
  const v = db.get().prepare('SELECT v.*, p.name AS product_name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.deleted_at IS NULL').get(int(req.params.variantId));
  if (!v) return next();
  const r = delivery.addStock(v.id, req.body.keys);
  res.locals.audit('stock_added', `Dodano ${r.added} kluczy do „${v.product_name} — ${v.name}”`, { variantId: v.id, added: r.added });
  const fulfilled = r.added ? delivery.retryAwaitingForVariant(v.id) : 0;
  req.flash('success', `Dodano: ${r.added}. Pominięto duplikaty: ${r.duplicates}.${fulfilled ? ` Ponowiono realizację ${fulfilled} oczekujących zamówień.` : ''}`);
  res.redirect(`${A()}/magazyn/${v.id}`);
});

router.post('/magazyn/:variantId/usun/:itemId', permit('stock'), (req, res) => {
  const r = db.get().prepare("UPDATE stock_items SET status='removed' WHERE id = ? AND variant_id = ? AND status='available'").run(int(req.params.itemId), int(req.params.variantId));
  if (r.changes) res.locals.audit('stock_removed', 'Usunięto klucz z magazynu', { variantId: int(req.params.variantId) });
  res.redirect(`${A()}/magazyn/${int(req.params.variantId)}`);
});

// ---------------------------------------------------------------------------
// Kategorie i platformy
// ---------------------------------------------------------------------------

router.get('/kategorie', permit('products'), (req, res) => {
  const conn = db.get();
  res.render('admin/taxonomy', {
    title: 'Kategorie i platformy',
    categories: conn.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS n FROM categories c ORDER BY c.sort, c.name').all(),
    platforms: conn.prepare('SELECT pl.*, (SELECT COUNT(*) FROM products p WHERE p.platform_id = pl.id AND p.deleted_at IS NULL) AS n FROM platforms pl ORDER BY pl.sort, pl.name').all(),
  });
});

router.post('/kategorie', permit('products'), (req, res) => {
  const conn = db.get();
  const name = str(req.body.name, 80);
  const id = int(req.body.id);
  if (name.length < 2) { req.flash('error', 'Podaj nazwę kategorii.'); return res.redirect(`${A()}/kategorie`); }
  let slug = slugify(str(req.body.slug) || name);
  if (conn.prepare('SELECT 1 FROM categories WHERE slug = ? AND id != ?').get(slug, id || 0)) slug = `${slug}-${Date.now() % 1000}`;
  let parent = int(req.body.parent_id) || null;
  if (parent === id) parent = null;
  if (parent && conn.prepare('SELECT parent_id FROM categories WHERE id = ?').get(parent)?.parent_id) parent = null; // max 2 poziomy
  if (id) {
    conn.prepare('UPDATE categories SET name=?, slug=?, description=?, parent_id=?, sort=?, active=? WHERE id=?')
      .run(name, slug, str(req.body.description, 300), parent, int(req.body.sort), bool(req.body.active) ? 1 : 0, id);
  } else {
    conn.prepare('INSERT INTO categories (name, slug, description, parent_id, sort, active) VALUES (?,?,?,?,?,1)')
      .run(name, slug, str(req.body.description, 300), parent, int(req.body.sort));
  }
  req.flash('success', 'Zapisano kategorię.');
  res.redirect(`${A()}/kategorie`);
});

router.post('/kategorie/:id/usun', permit('products'), (req, res) => {
  db.get().prepare('DELETE FROM categories WHERE id = ?').run(int(req.params.id));
  req.flash('success', 'Usunięto kategorię (produkty pozostały bez kategorii).');
  res.redirect(`${A()}/kategorie`);
});

router.post('/platformy', permit('products'), (req, res) => {
  const conn = db.get();
  const name = str(req.body.name, 60);
  const id = int(req.body.id);
  if (name.length < 2) { req.flash('error', 'Podaj nazwę platformy.'); return res.redirect(`${A()}/kategorie`); }
  let slug = slugify(str(req.body.slug) || name);
  if (conn.prepare('SELECT 1 FROM platforms WHERE slug = ? AND id != ?').get(slug, id || 0)) slug = `${slug}-${Date.now() % 1000}`;
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#c6f432';
  if (id) {
    conn.prepare('UPDATE platforms SET name=?, slug=?, color=?, sort=?, active=? WHERE id=?').run(name, slug, color, int(req.body.sort), bool(req.body.active) ? 1 : 0, id);
  } else {
    conn.prepare('INSERT INTO platforms (name, slug, color, sort, active) VALUES (?,?,?,?,1)').run(name, slug, color, int(req.body.sort));
  }
  req.flash('success', 'Zapisano platformę.');
  res.redirect(`${A()}/kategorie#platformy`);
});

router.post('/platformy/:id/usun', permit('products'), (req, res) => {
  db.get().prepare('DELETE FROM platforms WHERE id = ?').run(int(req.params.id));
  req.flash('success', 'Usunięto platformę.');
  res.redirect(`${A()}/kategorie#platformy`);
});

// Błędy wgrywania plików (np. za duży plik)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    cleanupTmp(req);
    req.flash('error', err.code === 'LIMIT_FILE_SIZE' ? `Plik jest za duży (limit ${config.maxDeliveryFileMb} MB).` : `Błąd przesyłania: ${err.message}`);
    return res.redirect(req.originalUrl.split('?')[0]);
  }
  next(err);
});

module.exports = router;
