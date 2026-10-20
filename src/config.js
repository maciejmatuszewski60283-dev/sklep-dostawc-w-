'use strict';
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');
if (process.env.NODE_ENV !== 'test' && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

function required(name, fallbackForDev) {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (isProd) {
    throw new Error(`Brak wymaganej zmiennej środowiskowej ${name}. Zobacz .env.example`);
  }
  return fallbackForDev;
}

function normalizeAdminPath(p) {
  let v = (p || '/admin').trim();
  if (!v.startsWith('/')) v = '/' + v;
  v = v.replace(/\/+$/, '');
  if (!/^\/[a-zA-Z0-9_-]{3,64}$/.test(v)) throw new Error('ADMIN_PATH może zawierać tylko litery, cyfry, - i _ (3–64 znaki)');
  return v;
}

const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
const encryptionKey = required('ENCRYPTION_KEY', '0'.repeat(63) + '1');
if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
  throw new Error('ENCRYPTION_KEY musi mieć dokładnie 64 znaki hex. Użyj: npm run secrets:generate');
}
const sessionSecret = required('SESSION_SECRET', 'dev-only-session-secret-change-me-please-0000');
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET musi mieć min. 32 znaki');

const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
if (isProd && !publicUrl.startsWith('https://')) {
  throw new Error('W produkcji PUBLIC_URL musi zaczynać się od https://');
}

module.exports = {
  env,
  isProd,
  isTest,
  root,
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl,
  adminPath: normalizeAdminPath(process.env.ADMIN_PATH),
  sessionSecret,
  encryptionKey: Buffer.from(encryptionKey, 'hex'),
  dataDir,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'shop.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  privateDir: path.join(dataDir, 'private'),
  trustProxy: parseInt(process.env.TRUST_PROXY || '0', 10),
  maxDeliveryFileMb: parseInt(process.env.MAX_DELIVERY_FILE_MB || '100', 10),
  secureCookies: publicUrl.startsWith('https://'),
  // Workery (płatności, kolejka) można wyłączyć np. w testach
  runWorkers: process.env.RUN_WORKERS !== '0',
};
