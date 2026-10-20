'use strict';
// Trwała kolejka zadań w bazie danych (e-maile, realizacja zamówień, powiadomienia).
// Zadania przetrwają restart serwera, a nieudane są ponawiane z rosnącym odstępem.
const db = require('../db');
const events = require('../lib/events');

const handlers = new Map();
let timer = null;
let running = false;

function register(type, fn) {
  handlers.set(type, fn);
}

/** Dodaje zadanie. Jeśli podano uniqueKey i takie zadanie już istnieje — nic nie robi (idempotencja). */
function enqueue(type, payload = {}, { uniqueKey = null, delayMs = 0, maxAttempts = 6 } = {}) {
  const r = db.get().prepare(
    `INSERT INTO jobs (type, unique_key, payload, run_at, max_attempts) VALUES (?,?,?,?,?)
     ON CONFLICT(unique_key) DO NOTHING`
  ).run(type, uniqueKey, JSON.stringify(payload), Date.now() + delayMs, maxAttempts);
  return r.changes ? r.lastInsertRowid : null;
}

function backoffMs(attempt) {
  return Math.min(6 * 60 * 60 * 1000, 60 * 1000 * attempt * attempt);
}

async function runJob(job) {
  const fn = handlers.get(job.type);
  const conn = db.get();
  if (!fn) {
    conn.prepare("UPDATE jobs SET status='failed', last_error=?, updated_at=datetime('now') WHERE id=?").run('Nieznany typ zadania', job.id);
    return;
  }
  const attempts = job.attempts + 1;
  conn.prepare("UPDATE jobs SET status='running', attempts=?, updated_at=datetime('now') WHERE id=?").run(attempts, job.id);
  try {
    await fn(JSON.parse(job.payload || '{}'), job);
    conn.prepare("UPDATE jobs SET status='done', last_error=NULL, updated_at=datetime('now') WHERE id=?").run(job.id);
  } catch (e) {
    const final = attempts >= job.max_attempts || e.permanent;
    conn.prepare("UPDATE jobs SET status=?, last_error=?, run_at=?, updated_at=datetime('now') WHERE id=?")
      .run(final ? 'failed' : 'queued', String(e.message).slice(0, 500), Date.now() + backoffMs(attempts), job.id);
    events[final ? 'error' : 'warn']('system', 'job_failed',
      `Zadanie ${job.type} #${job.id} nie powiodło się (próba ${attempts}/${job.max_attempts}): ${e.message}`, { jobId: job.id });
    if (final && job.type !== 'notify_admin') {
      const onFail = handlers.get(`${job.type}:failed`);
      if (onFail) { try { await onFail(JSON.parse(job.payload || '{}'), e); } catch { /* ignore */ } }
    }
  }
}

/** Przetwarza wszystkie zaległe zadania (używane przez workera i w testach). */
async function drain(limit = 50) {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    for (;;) {
      const job = db.get().prepare("SELECT * FROM jobs WHERE status='queued' AND run_at <= ? ORDER BY run_at, id LIMIT 1").get(Date.now());
      if (!job || n >= limit) break;
      await runJob(job);
      n++;
    }
  } finally {
    running = false;
  }
  return n;
}

function retry(jobId) {
  return db.get().prepare("UPDATE jobs SET status='queued', run_at=?, max_attempts=max_attempts+1, updated_at=datetime('now') WHERE id=? AND status='failed'")
    .run(Date.now(), jobId).changes;
}

function start(intervalMs = 2000) {
  // Zadania przerwane przez restart wracają do kolejki
  db.get().prepare("UPDATE jobs SET status='queued' WHERE status='running'").run();
  timer = setInterval(() => { drain().catch((e) => console.error('[jobs]', e)); }, intervalMs);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { register, enqueue, drain, retry, start, stop };
