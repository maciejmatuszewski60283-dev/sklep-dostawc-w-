'use strict';
// Wspólne narzędzia testowe: osobna baza w katalogu tymczasowym, atrapa sieci (HTTP) i poczty.
// UWAGA: atrapy istnieją wyłącznie w testach — kod produkcyjny zawsze korzysta z prawdziwych API.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ni-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dir;
process.env.RUN_WORKERS = '0';
process.env.PUBLIC_URL = 'http://shop.test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijkl';

const request = require('supertest');
const db = require('../src/db');
const http = require('../src/lib/http');
const email = require('../src/services/email');
const { createApp } = require('../src/app');
require('../src/services/delivery');
require('../src/services/seed').ensureBase();
require('../src/lib/settings').set('email.from_address', 'sklep@example.com');

const sent = [];
let mailFail = false;
email._setTransport({
  async sendMail(msg) {
    if (mailFail) throw new Error('SMTP niedostępny (symulacja)');
    sent.push(msg);
    return { messageId: `<${sent.length}@test>` };
  },
});

// Routing atrapy HTTP: lista [regex, handler(url, opts) => body|{status, body}]
let routes = [];
http._setFetch(async (url, opts = {}) => {
  for (const [re, fn] of routes) {
    if (re.test(url)) {
      let out = await fn(url, opts);
      if (!out || out.status === undefined || out.body === undefined) out = { status: 200, body: out };
      const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
      return new Response(text, { status: out.status, headers: { 'content-type': 'application/json' } });
    }
  }
  throw new Error(`Brak atrapy dla ${url}`);
});

function mock(re, fn) { routes.unshift([re, fn]); }
function resetMocks() { routes = []; }

/** Agent z obsługą CSRF: pobiera token ze strony i dokleja do formularzy. */
function agent(app) {
  const a = request.agent(app);
  a.csrf = async (url = '/zamowienie') => {
    const res = await a.get(url);
    const m = /name="_csrf" value="([^"]+)"/.exec(res.text);
    if (!m) throw new Error(`Brak tokenu CSRF na ${url} (status ${res.status})`);
    return m[1];
  };
  return a;
}

module.exports = {
  dir, db, request, createApp, agent, mock, resetMocks, sent,
  setMailFail: (v) => { mailFail = v; },
  conn: () => db.get(),
};
