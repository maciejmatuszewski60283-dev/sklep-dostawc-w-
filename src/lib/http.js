'use strict';
// Prosty klient HTTP z limitem czasu. W testach podmieniany przez http._setFetch().
let impl = (...args) => fetch(...args);

async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const res = await impl(url, {
    method,
    headers: { 'user-agent': 'najtansze-itemki/1.0', accept: 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* nie-JSON */ }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} z ${new URL(url).host}: ${(text || '').slice(0, 200)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json ?? text;
}

module.exports = {
  getJson: (url, opts) => request(url, opts),
  postJson: (url, data, opts = {}) => request(url, {
    ...opts, method: 'POST', headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: JSON.stringify(data),
  }),
  _setFetch: (fn) => { impl = fn; },
  _resetFetch: () => { impl = (...args) => fetch(...args); },
};
