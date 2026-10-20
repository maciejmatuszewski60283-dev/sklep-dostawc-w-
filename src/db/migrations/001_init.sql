-- Schemat bazy sklepu "najtańsze itemki"
-- Kwoty w walucie sklepu przechowujemy w jednostkach podstawowych (grosze/centy) jako INTEGER.
-- Kwoty kryptowalut przechowujemy jako TEXT z liczbą całkowitą w najmniejszych jednostkach (satoshi, wei itp.).

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  is_secret INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','support')),
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  password_changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  ts INTEGER NOT NULL,
  success INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts_key ON login_attempts(key, ts);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE platforms (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#c6f432',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE delivery_files (
  id INTEGER PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  description_md TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  platform_id INTEGER REFERENCES platforms(id) ON DELETE SET NULL,
  region TEXT NOT NULL DEFAULT '',
  delivery_type TEXT NOT NULL DEFAULT 'keys' CHECK (delivery_type IN ('keys','file','manual')),
  delivery_file_id INTEGER REFERENCES delivery_files(id) ON DELETE SET NULL,
  delivery_info_md TEXT NOT NULL DEFAULT '',
  requirements_md TEXT NOT NULL DEFAULT '',
  rights_confirmed INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_products_active ON products(active, deleted_at);

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  thumb TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_images_product ON product_images(product_id, sort);

CREATE TABLE variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  compare_at_minor INTEGER,
  manual_stock INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX idx_variants_product ON variants(product_id);

CREATE TABLE stock_items (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  content_enc TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','removed')),
  order_item_id INTEGER REFERENCES order_items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sold_at TEXT,
  UNIQUE(variant_id, content_hash)
);
CREATE INDEX idx_stock_variant_status ON stock_items(variant_id, status);

CREATE TABLE discount_codes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value INTEGER NOT NULL CHECK (value > 0),
  min_order_minor INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  starts_at TEXT,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  access_token_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'awaiting_payment','underpaid','paid','awaiting_stock','fulfilled','expired','cancelled','refunded')),
  currency TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  discount_code_id INTEGER REFERENCES discount_codes(id),
  discount_code TEXT,
  ip_hash TEXT,
  terms_accepted_at TEXT NOT NULL,
  withdrawal_consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  fulfilled_at TEXT,
  delivery_access_until TEXT,
  refund_tx TEXT,
  refund_note TEXT,
  admin_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_email ON orders(email);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  variant_id INTEGER REFERENCES variants(id),
  product_name TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  delivery_type TEXT NOT NULL,
  delivery_file_id INTEGER REFERENCES delivery_files(id),
  unit_price_minor INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  delivered_at TEXT,
  manual_delivery_enc TEXT
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('direct','nowpayments')),
  asset TEXT NOT NULL,
  address TEXT NOT NULL,
  address_index INTEGER,
  amount_atomic TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  rate TEXT NOT NULL,
  fiat_amount_minor INTEGER NOT NULL,
  received_atomic TEXT NOT NULL DEFAULT '0',
  confirmed_atomic TEXT NOT NULL DEFAULT '0',
  required_confirmations INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('pending','confirming','underpaid','paid','expired','failed','refunded')),
  overpaid INTEGER NOT NULL DEFAULT 0,
  late INTEGER NOT NULL DEFAULT 0,
  provider_payment_id TEXT,
  provider_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  watch_until TEXT NOT NULL,
  paid_at TEXT,
  last_checked_at TEXT,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  check_errors INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_payments_status ON payments(status, next_check_at);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE UNIQUE INDEX idx_payments_provider_id ON payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;

CREATE TABLE payment_txs (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  txid TEXT NOT NULL,
  out_index INTEGER NOT NULL DEFAULT 0,
  amount_atomic TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  block_time INTEGER,
  block_number INTEGER,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'watcher',
  UNIQUE(asset, txid, out_index)
);

-- Wpływy na wspólny adres (sieci EVM/Tron), których nie udało się automatycznie przypisać do zamówienia
-- (np. klient wysłał inną kwotę). Obsługa może je przypisać ręcznie w panelu.
CREATE TABLE unmatched_transfers (
  id INTEGER PRIMARY KEY,
  asset TEXT NOT NULL,
  txid TEXT NOT NULL,
  out_index INTEGER NOT NULL DEFAULT 0,
  amount_atomic TEXT NOT NULL,
  block_number INTEGER,
  block_time INTEGER,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_payment_id INTEGER REFERENCES payments(id),
  UNIQUE(asset, txid, out_index)
);

-- Zgłoszenia klientów "wysłałem płatność, oto hash transakcji" — wymagają decyzji obsługi
CREATE TABLE payment_claims (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  txid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  UNIQUE(payment_id, txid)
);

CREATE TABLE address_pool (
  id INTEGER PRIMARY KEY,
  asset TEXT NOT NULL,
  xpub_fingerprint TEXT NOT NULL,
  idx INTEGER NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_use','free','used')),
  last_payment_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(asset, xpub_fingerprint, idx)
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  unique_key TEXT UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  run_at INTEGER NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_due ON jobs(status, run_at);

CREATE TABLE emails (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  to_addr TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX idx_emails_order ON emails(order_id);

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('delivered','awaiting_stock','manual_pending','failed')),
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deliveries_order ON deliveries(order_id);

CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload TEXT NOT NULL,
  result TEXT,
  UNIQUE(provider, event_key)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT,
  ip TEXT,
  admin_user_id INTEGER
);
CREATE INDEX idx_events_ts ON events(ts);
CREATE INDEX idx_events_cat ON events(category, ts);

CREATE TABLE pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  show_in_footer INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historia cen (wymóg dyrektywy Omnibus: przy obniżce pokazujemy najniższą cenę z 30 dni przed obniżką)
CREATE TABLE price_history (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  price_minor INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_price_history_variant ON price_history(variant_id, changed_at);

-- Linki dostępu do zamówień (w bazie tylko skróty tokenów). Każdy e-mail dostaje własny token.
CREATE TABLE order_access_tokens (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_order_tokens_order ON order_access_tokens(order_id);
