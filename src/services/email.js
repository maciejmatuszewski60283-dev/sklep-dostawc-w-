'use strict';
// Wysyłka e-maili przez SMTP skonfigurowany w panelu. Każda wiadomość jest zapisywana w historii (tabela emails).
const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const db = require('../db');
const settings = require('../lib/settings');
const config = require('../config');
const jobs = require('./jobs');
const events = require('../lib/events');
const money = require('../lib/money');
const util = require('../lib/util');

let testTransport = null; // w testach: przechwytywanie wiadomości

function transport() {
  if (testTransport) return testTransport;
  const host = settings.get('email.smtp_host');
  if (!host) {
    const e = new Error('Serwer SMTP nie jest skonfigurowany (Ustawienia → E-mail).');
    throw e;
  }
  return nodemailer.createTransport({
    host,
    port: settings.getInt('email.smtp_port', 587),
    secure: settings.getBool('email.smtp_secure'),
    requireTLS: !settings.getBool('email.smtp_secure'),
    auth: settings.get('email.smtp_user') ? { user: settings.get('email.smtp_user'), pass: settings.get('email.smtp_pass') } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

function fromHeader() {
  const addr = settings.get('email.from_address');
  if (!addr) throw new Error('Brak adresu nadawcy (Ustawienia → E-mail).');
  return { name: settings.get('email.from_name') || settings.get('shop.name'), address: addr };
}

function loadOrder(orderId) {
  const conn = db.get();
  const order = conn.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  order.items = conn.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  order.payment = conn.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId) || null;
  return order;
}

async function render(template, data) {
  const shop = settings.publicView();
  const locals = { ...data, shop, publicUrl: config.publicUrl, money, util, ASSETS: require('./payments/assets').ASSETS, fmt: (m) => money.formatMinor(m, shop.currency) };
  if (data.orderId) {
    locals.order = loadOrder(data.orderId);
    if (!locals.order) { const e = new Error('Zamówienie nie istnieje'); e.permanent = true; throw e; }
    // Link generowany w chwili wysyłki — token nie jest nigdzie zapisywany jawnie
    if (!locals.url) locals.url = require('./order-access').url(locals.order);
  }
  const html = await ejs.renderFile(path.join(config.root, 'views', 'emails', `${template}.ejs`), locals, { async: false });
  const text = await ejs.renderFile(path.join(config.root, 'views', 'emails', `${template}.txt.ejs`), locals, { async: false, escape: (s) => String(s ?? '') });
  return { html, text };
}

/** Kolejkuje e-mail. uniqueKey zapobiega podwójnej wysyłce (np. przy powtórzonym webhooku). */
function queue({ to, kind, subject, template, data = {}, orderId = null, uniqueKey = null }) {
  const conn = db.get();
  return conn.transaction(() => {
    if (uniqueKey) {
      const exists = conn.prepare('SELECT 1 FROM jobs WHERE unique_key = ?').get(uniqueKey);
      if (exists) return null;
    }
    const emailId = conn.prepare('INSERT INTO emails (order_id, to_addr, kind, subject) VALUES (?,?,?,?)').run(orderId, to, kind, subject).lastInsertRowid;
    jobs.enqueue('send_email', { emailId, template, data }, { uniqueKey, maxAttempts: 6 });
    return emailId;
  })();
}

async function sendEmailJob({ emailId, template, data }) {
  const conn = db.get();
  const row = conn.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
  if (!row || row.status === 'sent') return;
  conn.prepare('UPDATE emails SET attempts = attempts + 1 WHERE id = ?').run(emailId);
  try {
    const { html, text } = await render(template, data);
    const info = await transport().sendMail({ from: fromHeader(), to: row.to_addr, subject: row.subject, html, text });
    conn.prepare("UPDATE emails SET status='sent', sent_at=datetime('now'), message_id=?, last_error=NULL WHERE id=?").run(info.messageId || null, emailId);
  } catch (e) {
    conn.prepare('UPDATE emails SET last_error = ? WHERE id = ?').run(String(e.message).slice(0, 500), emailId);
    throw e;
  }
}

jobs.register('send_email', sendEmailJob);
jobs.register('send_email:failed', ({ emailId }) => {
  const conn = db.get();
  conn.prepare("UPDATE emails SET status='failed' WHERE id=?").run(emailId);
  const row = conn.prepare('SELECT * FROM emails WHERE id=?').get(emailId);
  events.error('email', 'email_failed', `Nie udało się wysłać e-maila "${row && row.subject}" (zamówienie #${row && row.order_id})`, { emailId });
  if (row && row.kind !== 'admin' && settings.getBool('notify.on_delivery_failed')) {
    notifyAdmin('Błąd wysyłki e-maila', `Nie udało się wysłać wiadomości "${row.subject}" do klienta. Sprawdź Panel → Dostawy i ponów wysyłkę.`);
  }
});

/** Ponowna wysyłka nieudanego e-maila z panelu. */
function retryEmail(emailId) {
  const conn = db.get();
  const job = conn.prepare("SELECT id, payload FROM jobs WHERE type='send_email' AND json_extract(payload,'$.emailId') = ? ORDER BY id DESC LIMIT 1").get(emailId);
  conn.prepare("UPDATE emails SET status='queued', last_error=NULL WHERE id=?").run(emailId);
  if (job) {
    conn.prepare("UPDATE jobs SET status='queued', run_at=?, attempts=0, updated_at=datetime('now') WHERE id=?").run(Date.now(), job.id);
  }
  return Boolean(job);
}

function notifyAdmin(subject, message) {
  const to = settings.get('notify.admin_email');
  if (!to) return null;
  return queue({ to, kind: 'admin', subject: `[${settings.get('shop.name')}] ${subject}`, template: 'admin-notice', data: { message } });
}

async function sendTest(to) {
  const { html, text } = await render('test', {});
  return transport().sendMail({ from: fromHeader(), to, subject: `Test e-mail — ${settings.get('shop.name')}`, html, text });
}

module.exports = { queue, notifyAdmin, sendTest, retryEmail, render, _setTransport: (t) => { testTransport = t; } };
