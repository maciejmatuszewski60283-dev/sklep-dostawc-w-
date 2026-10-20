'use strict';
const db = require('../db');
const { escapeLike } = require('../lib/util');

// Dostępność wariantu = wolne klucze (lub stan ręczny) minus sztuki zarezerwowane w nieopłaconych, ważnych zamówieniach.
const RESERVED_SQL = `COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.variant_id = v.id AND o.status = 'awaiting_payment' AND o.expires_at > datetime('now')), 0)`;

const AVAILABLE_SQL = `CASE p.delivery_type
  WHEN 'keys' THEN (SELECT COUNT(*) FROM stock_items s WHERE s.variant_id = v.id AND s.status = 'available') - ${RESERVED_SQL}
  ELSE CASE WHEN v.manual_stock IS NULL THEN 999999 ELSE v.manual_stock - ${RESERVED_SQL} END
END`;

function variantsFor(productIds) {
  if (!productIds.length) return new Map();
  const rows = db.get().prepare(`
    SELECT v.*, ${AVAILABLE_SQL} AS available
    FROM variants v JOIN products p ON p.id = v.product_id
    WHERE v.product_id IN (${productIds.map(() => '?').join(',')}) AND v.deleted_at IS NULL
    ORDER BY v.sort, v.price_minor, v.id`).all(...productIds);
  const map = new Map();
  for (const r of rows) {
    r.available = Math.max(0, r.available);
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push(r);
  }
  return map;
}

function imagesFor(productIds) {
  if (!productIds.length) return new Map();
  const rows = db.get().prepare(`SELECT * FROM product_images WHERE product_id IN (${productIds.map(() => '?').join(',')}) ORDER BY sort, id`).all(...productIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push(r);
  }
  return map;
}

function decorate(products, { onlyActiveVariants = true } = {}) {
  const ids = products.map((p) => p.id);
  const vmap = variantsFor(ids);
  const imap = imagesFor(ids);
  for (const p of products) {
    p.variants = (vmap.get(p.id) || []).filter((v) => !onlyActiveVariants || v.active);
    p.images = imap.get(p.id) || [];
    p.mainImage = p.images[0] || null;
    const prices = p.variants.map((v) => v.price_minor);
    p.priceFrom = prices.length ? Math.min(...prices) : null;
    const cheapest = p.variants.find((v) => v.price_minor === p.priceFrom);
    p.compareAt = cheapest && cheapest.compare_at_minor > cheapest.price_minor ? cheapest.compare_at_minor : null;
    p.available = p.variants.reduce((a, v) => a + v.available, 0);
    p.inStock = p.available > 0;
  }
  return products;
}

const BASE_SELECT = `SELECT p.*, c.name AS category_name, c.slug AS category_slug, pl.name AS platform_name, pl.slug AS platform_slug, pl.color AS platform_color
  FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN platforms pl ON pl.id = p.platform_id`;

const SORTS = {
  popular: 'p.featured DESC, p.sort, p.id DESC',
  newest: 'p.id DESC',
  price_asc: 'min_price ASC, p.id DESC',
  price_desc: 'min_price DESC, p.id DESC',
  name: 'p.name COLLATE NOCASE ASC',
};

/** Wyszukiwanie produktów z filtrami (publiczny katalog). */
function search({ q = '', category = '', platform = '', minPrice = null, maxPrice = null, inStock = false, sort = 'popular', page = 1, perPage = 24 } = {}) {
  const where = ['p.active = 1', 'p.deleted_at IS NULL'];
  const params = [];
  if (q) {
    const terms = String(q).trim().split(/\s+/).slice(0, 6);
    for (const t of terms) {
      where.push("(p.name LIKE ? ESCAPE '\\' OR p.short_description LIKE ? ESCAPE '\\' OR pl.name LIKE ? ESCAPE '\\')");
      const like = `%${escapeLike(t)}%`;
      params.push(like, like, like);
    }
  }
  if (category) {
    where.push('(c.slug = ? OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))');
    params.push(category, category);
  }
  if (platform) {
    where.push('pl.slug = ?');
    params.push(platform);
  }
  const priceSub = '(SELECT MIN(price_minor) FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.deleted_at IS NULL)';
  if (minPrice != null) { where.push(`${priceSub} >= ?`); params.push(minPrice); }
  if (maxPrice != null) { where.push(`${priceSub} <= ?`); params.push(maxPrice); }
  where.push(`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.deleted_at IS NULL)`);
  if (inStock) {
    where.push(`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.deleted_at IS NULL AND (${AVAILABLE_SQL}) > 0)`);
  }
  const whereSql = where.join(' AND ');
  const conn = db.get();
  const total = conn.prepare(`SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN platforms pl ON pl.id = p.platform_id WHERE ${whereSql}`).get(...params).n;
  const order = SORTS[sort] || SORTS.popular;
  const limit = Math.min(60, Math.max(1, perPage));
  const offset = (Math.max(1, page) - 1) * limit;
  const rows = conn.prepare(`SELECT * FROM (SELECT p.*, c.name AS category_name, c.slug AS category_slug, pl.name AS platform_name, pl.slug AS platform_slug, pl.color AS platform_color, ${priceSub} AS min_price
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN platforms pl ON pl.id = p.platform_id WHERE ${whereSql}) p
    ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { items: decorate(rows), total, page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / limit)) };
}

function bySlug(slug) {
  const p = db.get().prepare(`${BASE_SELECT} WHERE p.slug = ? AND p.active = 1 AND p.deleted_at IS NULL`).get(slug);
  return p ? decorate([p])[0] : null;
}

function featured(limit = 8) {
  const rows = db.get().prepare(`${BASE_SELECT} WHERE p.active = 1 AND p.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.deleted_at IS NULL)
    ORDER BY p.featured DESC, p.sort, p.id DESC LIMIT ?`).all(limit);
  return decorate(rows);
}

function related(product, limit = 4) {
  const rows = db.get().prepare(`${BASE_SELECT} WHERE p.active = 1 AND p.deleted_at IS NULL AND p.id != ?
    AND (p.platform_id = ? OR p.category_id = ?)
    AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.deleted_at IS NULL)
    ORDER BY p.featured DESC, RANDOM() LIMIT ?`).all(product.id, product.platform_id, product.category_id, limit);
  return decorate(rows);
}

function categoriesTree() {
  const rows = db.get().prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.active = 1 AND p.deleted_at IS NULL AND (p.category_id = c.id OR p.category_id IN (SELECT id FROM categories WHERE parent_id = c.id))) AS product_count
    FROM categories c WHERE c.active = 1 ORDER BY c.sort, c.name`).all();
  const top = rows.filter((r) => !r.parent_id);
  for (const t of top) t.children = rows.filter((r) => r.parent_id === t.id);
  return top;
}

function platforms() {
  return db.get().prepare(`SELECT pl.*, (SELECT COUNT(*) FROM products p WHERE p.platform_id = pl.id AND p.active = 1 AND p.deleted_at IS NULL) AS product_count
    FROM platforms pl WHERE pl.active = 1 ORDER BY pl.sort, pl.name`).all();
}

/** Wariant gotowy do sprzedaży (aktywny produkt i wariant) z aktualną dostępnością. */
function sellableVariant(variantId) {
  const v = db.get().prepare(`SELECT v.*, p.name AS product_name, p.slug AS product_slug, p.delivery_type, p.delivery_file_id, p.active AS product_active,
      (SELECT thumb FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS thumb,
      pl.name AS platform_name, ${AVAILABLE_SQL} AS available
    FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN platforms pl ON pl.id = p.platform_id
    WHERE v.id = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL`).get(variantId);
  if (!v || !v.active || !v.product_active) return null;
  v.available = Math.max(0, v.available);
  return v;
}

module.exports = { search, bySlug, featured, related, categoriesTree, platforms, sellableVariant, decorate, AVAILABLE_SQL, SORTS };

/** Najniższa cena z 30 dni przed ostatnią zmianą ceny (Omnibus). */
function lowestPrice30(variantId, currentPrice) {
  const conn = db.get();
  const last = conn.prepare('SELECT changed_at FROM price_history WHERE variant_id = ? ORDER BY changed_at DESC, id DESC LIMIT 1').get(variantId);
  if (!last) return currentPrice;
  const r = conn.prepare(`SELECT MIN(price_minor) AS m FROM price_history WHERE variant_id = ? AND (
      (changed_at < ? AND changed_at >= datetime(?, '-30 days'))
      OR id = (SELECT id FROM price_history WHERE variant_id = ? AND changed_at <= datetime(?, '-30 days') ORDER BY changed_at DESC, id DESC LIMIT 1))`)
    .get(variantId, last.changed_at, last.changed_at, variantId, last.changed_at);
  return r && r.m != null ? r.m : currentPrice;
}

module.exports.lowestPrice30 = lowestPrice30;
