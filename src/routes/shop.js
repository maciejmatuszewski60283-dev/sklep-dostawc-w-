'use strict';
const express = require('express');
const db = require('../db');
const catalog = require('../services/catalog');
const cart = require('../services/cart');
const markdown = require('../lib/markdown');
const money = require('../lib/money');
const { int, str } = require('../lib/util');
const { limits } = require('../middleware/security');
const pconfig = require('../services/payments/config');

const router = express.Router();

/** Powrót na poprzednią stronę tylko w obrębie sklepu (ochrona przed open redirect). */
function safeBack(req, fallback) {
  try {
    const u = new URL(req.get('referer') || '');
    if (u.host !== req.get('host')) return fallback;
    const target = u.pathname + u.search;
    return target.startsWith('/') && !target.startsWith('//') ? target : fallback;
  } catch {
    return fallback;
  }
}

function footerPages() {
  return db.get().prepare('SELECT slug, title FROM pages WHERE show_in_footer = 1 ORDER BY sort, title').all();
}

router.use((req, res, next) => {
  res.locals.footerPages = footerPages();
  res.locals.navPlatforms = catalog.platforms().filter((p) => p.product_count > 0).slice(0, 8);
  res.locals.acceptedAssets = pconfig.enabledAssets().map((a) => ({ code: a.code, symbol: a.symbol, network: a.network, icon: a.icon }));
  next();
});

router.get('/', (req, res) => {
  res.render('shop/home', {
    title: null,
    featured: catalog.featured(8),
    categories: catalog.categoriesTree(),
    platforms: catalog.platforms(),
  });
});

function catalogPage(req, res, extra = {}) {
  const q = str(req.query.q, 100);
  const filters = {
    q,
    category: str(extra.category ?? req.query.kategoria, 80),
    platform: str(extra.platform ?? req.query.platforma, 80),
    minPrice: req.query.od ? money.parseMinor(req.query.od) : null,
    maxPrice: req.query.do ? money.parseMinor(req.query.do) : null,
    inStock: req.query.dostepne === '1',
    sort: catalog.SORTS[req.query.sort] ? req.query.sort : 'popular',
    page: Math.max(1, Math.min(500, int(req.query.strona, 1))),
  };
  const result = catalog.search(filters);
  const categories = catalog.categoriesTree();
  const platforms = catalog.platforms();
  const activeCategory = categories.flatMap((c) => [c, ...c.children]).find((c) => c.slug === filters.category);
  const activePlatform = platforms.find((p) => p.slug === filters.platform);
  let heading = 'Wszystkie produkty';
  if (q) heading = `Wyniki dla „${q}”`;
  else if (activeCategory) heading = activeCategory.name;
  else if (activePlatform) heading = activePlatform.name;
  res.render('shop/catalog', { title: heading, heading, result, filters, categories, platforms, activeCategory, activePlatform });
}

router.get('/produkty', limits.search, (req, res) => catalogPage(req, res));
router.get('/szukaj', limits.search, (req, res) => catalogPage(req, res));
router.get('/kategoria/:slug', (req, res) => catalogPage(req, res, { category: req.params.slug }));
router.get('/platforma/:slug', (req, res) => catalogPage(req, res, { platform: req.params.slug }));

router.get('/produkt/:slug', (req, res, next) => {
  const product = catalog.bySlug(req.params.slug);
  if (!product || !product.variants.length) return next();
  for (const v of product.variants) {
    v.lowest30 = v.compare_at_minor > v.price_minor ? catalog.lowestPrice30(v.id, v.price_minor) : null;
  }
  const selected = product.variants.find((v) => v.id === int(req.query.wariant)) || product.variants.find((v) => v.available > 0) || product.variants[0];
  res.render('shop/product', {
    title: product.name,
    product,
    selected,
    descriptionHtml: markdown.render(product.description_md),
    deliveryHtml: markdown.render(product.delivery_info_md),
    requirementsHtml: markdown.render(product.requirements_md),
    related: catalog.related(product),
  });
});

router.get('/strona/:slug', (req, res, next) => {
  const page = db.get().prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  if (!page) return next();
  res.render('shop/page', { title: page.title, page, html: markdown.render(page.body_md) });
});

// ----- Koszyk -----
router.get('/koszyk', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.render('shop/cart', { title: 'Koszyk', summary: cart.summary(req.session) });
});

router.post('/koszyk/dodaj', limits.cart, (req, res) => {
  const r = cart.add(req.session, int(req.body.variant_id), Math.max(1, Math.min(cart.MAX_QTY, int(req.body.qty, 1))));
  const wantsJson = req.get('accept') && req.get('accept').includes('application/json');
  if (wantsJson) return res.status(r.error ? 400 : 200).json(r.error ? { error: r.error } : { ok: true, count: cart.count(req.session) });
  if (r.error) {
    req.flash('error', r.error);
    return res.redirect(safeBack(req, '/koszyk'));
  }
  if (req.body.buy_now === '1') return res.redirect('/kasa');
  req.flash('success', `Dodano do koszyka: ${r.variant.product_name}`);
  return res.redirect('/koszyk');
});

router.post('/koszyk/zmien', limits.cart, (req, res) => {
  cart.update(req.session, int(req.body.variant_id), int(req.body.qty, 0));
  res.redirect('/koszyk');
});

router.post('/koszyk/usun', limits.cart, (req, res) => {
  cart.update(req.session, int(req.body.variant_id), 0);
  res.redirect('/koszyk');
});

router.post('/koszyk/rabat', limits.cart, (req, res) => {
  const code = str(req.body.code, 40);
  if (!code) {
    delete req.session.discountCode;
    return res.redirect(req.body.back === 'kasa' ? '/kasa' : '/koszyk');
  }
  const s = cart.summary(req.session);
  const d = require('../services/discounts').evaluate(code, s.subtotal);
  if (d.error) req.flash('error', d.error);
  else {
    req.session.discountCode = d.code;
    req.flash('success', `Kod ${d.code} został zastosowany.`);
  }
  res.redirect(req.body.back === 'kasa' ? '/kasa' : '/koszyk');
});

module.exports = router;
