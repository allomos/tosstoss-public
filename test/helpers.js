'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');
const { createServer } = require('../server');

// TOSSTOSS_URL=http://127.0.0.1:8787 runs the same tests against the Worker (npx wrangler dev).
// Each test gets its own room there, so tests do not see each other's devices.
async function startServer() {
  if (process.env.TOSSTOSS_URL) {
    const base = process.env.TOSSTOSS_URL.replace(/\/$/, '');
    const room = 'T' + crypto.randomBytes(5).toString('hex').toUpperCase();
    return { base, room, url: `${base.replace(/^http/, 'ws')}/ws?room=${room}`, close: async () => {} };
  }
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base.replace('http', 'ws') + '/ws';
  return { server, base, url, close: () => new Promise((r) => { for (const p of server.peers.values()) p.ws.terminate(); server.close(r); }) };
}

// A test client that records every message and can wait for one matching a predicate.
async function connect(url, name, device = 'desktop', extra = {}) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    if (!isBinary && data.toString() === 'pong') return; // heartbeat answer
    const msg = isBinary ? { binary: data } : JSON.parse(data.toString());
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const client = {
    ws, inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    wait(pred, ms = 3000) {
      const found = inbox.find(pred);
      if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout waiting for message')); }, ms);
        waiters.push(w);
      });
    },
    close: () => new Promise((r) => { ws.once('close', r); ws.close(); }),
  };
  client.send({ type: 'hello', name, device, ...extra });
  const welcome = await client.wait((m) => m.type === 'welcome');
  client.id = welcome.id;
  client.welcome = welcome;
  return client;
}

module.exports = { startServer, connect };
