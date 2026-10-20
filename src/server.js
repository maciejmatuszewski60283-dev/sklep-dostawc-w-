'use strict';
const fs = require('fs');
const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');
const jobs = require('./services/jobs');
const payments = require('./services/payments');
const session = require('./middleware/session');
require('./services/delivery'); // rejestracja zadań realizacji
require('./services/email');
const seed = require('./services/seed');

for (const dir of [config.dataDir, config.uploadsDir, config.privateDir]) fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
db.get();
seed.ensureBase();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`najtańsze itemki działa na porcie ${config.port} (${config.env})`);
  console.log(`Sklep: ${config.publicUrl}`);
  if (!config.isProd) console.log(`Panel: ${config.publicUrl}${config.adminPath}`);
});
server.headersTimeout = 30000;
server.requestTimeout = 120000;

if (config.runWorkers) {
  jobs.start();
  payments.startWatcher();
  setInterval(() => session.cleanup(), 3600 * 1000).unref();
}

function shutdown(sig) {
  console.log(`Otrzymano ${sig}, zamykanie...`);
  jobs.stop();
  payments.stopWatcher();
  server.close(() => {
    try { db.get().close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
