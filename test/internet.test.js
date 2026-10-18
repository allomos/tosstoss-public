'use strict';
// Internet version only (the Worker): hidden devices, rooms and grouping by network.
// Runs when TOSSTOSS_URL points at `npx wrangler dev`; skipped against the LAN server.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { connect } = require('./helpers');

const BASE = process.env.TOSSTOSS_URL && process.env.TOSSTOSS_URL.replace(/\/$/, '').replace(/^http/, 'ws');
const opts = { skip: !BASE && 'needs TOSSTOSS_URL (the Worker)' };
const room = () => 'T' + crypto.randomBytes(5).toString('hex').toUpperCase();

test('a hidden device is not listed and cannot receive, but can send', opts, async () => {
  // Grouped by network: every test client comes from the same address.
  const url = `${BASE}/ws`;
  const seen = await connect(url, '公开');
  const ghost = await connectHidden(url, '隐身');
  try {
    assert.strictEqual(ghost.welcome.hidden, true);
    assert.ok(ghost.welcome.peers.some((p) => p.id === seen.id), 'hidden device sees visible ones');
    await assert.rejects(seen.wait((m) => m.type === 'peer-joined' && m.peer.id === ghost.id, 500));

    // Nobody can send to the hidden device.
    const id1 = crypto.randomUUID();
    seen.send({ type: 'file-start', transferId: id1, to: [ghost.id], name: 'a.txt', size: 1 });
    const acc = await seen.wait((m) => m.type === 'file-accepted' && m.transferId === id1);
    assert.deepStrictEqual(acc.to, []);

    // The hidden device can send, and its name comes along.
    const id2 = crypto.randomUUID();
    ghost.send({ type: 'file-start', transferId: id2, to: [seen.id], name: 'b.txt', size: 1 });
    const start = await seen.wait((m) => m.type === 'file-start' && m.transferId === id2);
    assert.strictEqual(start.fromName, '隐身');
  } finally {
    await ghost.close();
    await seen.close();
  }
});

test('a room keeps its own list, and everyone in it is visible', opts, async () => {
  const r = room();
  const a = await connectHidden(`${BASE}/ws?room=${r}`, '甲');
  const b = await connect(`${BASE}/ws?room=${r}`, '乙');
  const outside = await connect(`${BASE}/ws?room=${room()}`, '丙');
  try {
    assert.strictEqual(a.welcome.room, r);
    assert.strictEqual(a.welcome.hidden, false);
    assert.deepStrictEqual(b.welcome.peers.map((p) => p.name), ['甲']);
    assert.deepStrictEqual(outside.welcome.peers, []);
  } finally {
    await Promise.all([a.close(), b.close(), outside.close()]);
  }
});

test('the server answers the page heartbeat', opts, async () => {
  const c = await connect(`${BASE}/ws?room=${room()}`, '心跳');
  try {
    const pong = new Promise((resolve) => c.ws.on('message', (d, bin) => { if (!bin && d.toString() === 'pong') resolve(); }));
    c.ws.send('ping');
    await pong;
  } finally {
    await c.close();
  }
});

function connectHidden(url, name) {
  // Like the page by default: the hello says hidden.
  return connect(url, name, 'desktop', { hidden: true });
}

test('a server with a size limit refuses bigger files, and senders that send more than they announced', opts, async (ctx) => {
  const r = room();
  const a = await connect(`${BASE}/ws?room=${r}`, '发');
  const b = await connect(`${BASE}/ws?room=${r}`, '收');
  try {
    const max = a.welcome.maxFileBytes;
    if (!max) { ctx.skip('this deployment has no limit'); return; }

    const big = crypto.randomUUID();
    a.send({ type: 'file-start', transferId: big, to: [b.id], name: 'big.bin', size: max + 1 });
    const rej = await a.wait((m) => m.type === 'file-rejected' && m.transferId === big);
    assert.strictEqual(rej.max, max);
    await assert.rejects(b.wait((m) => m.type === 'file-start' && m.transferId === big, 500));

    // Announce 10 bytes, send 20: the receiver gets a cancel, the sender a rejection.
    const liar = crypto.randomUUID();
    a.send({ type: 'file-start', transferId: liar, to: [b.id], name: 'small.bin', size: 10 });
    await a.wait((m) => m.type === 'file-accepted' && m.transferId === liar);
    a.ws.send(Buffer.concat([Buffer.from(liar, 'latin1'), Buffer.alloc(20)]));
    await b.wait((m) => m.type === 'file-cancel' && m.transferId === liar);
    await a.wait((m) => m.type === 'file-rejected' && m.transferId === liar);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
