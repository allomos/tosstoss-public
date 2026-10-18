'use strict';
// Internet version only (the Worker): grouping by network, rooms and the plaza.
// Runs when TOSSTOSS_URL points at `npx wrangler dev`; skipped against the LAN server.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { connect } = require('./helpers');

const BASE = process.env.TOSSTOSS_URL && process.env.TOSSTOSS_URL.replace(/\/$/, '').replace(/^http/, 'ws');
const opts = { skip: !BASE && 'needs TOSSTOSS_URL (the Worker)' };
const room = () => 'T' + crypto.randomBytes(5).toString('hex').toUpperCase();

test('everyone on one network is listed: there is no hidden mode any more', opts, async () => {
  // Grouped by network: every test client comes from the same address.
  const url = `${BASE}/ws`;
  const a = await connect(url, '甲');
  const b = await connect(url, '乙', 'desktop', { hidden: true }); // an old page may still say hidden
  try {
    assert.ok(b.welcome.peers.some((p) => p.id === a.id));
    await a.wait((m) => m.type === 'peer-joined' && m.peer.id === b.id);
    assert.strictEqual(b.welcome.plaza, 0);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test('the plaza is one list for every network, apart from the network list, with no direct links', opts, async () => {
  const a = await connect(`${BASE}/ws?plaza=1`, '广场甲');
  const b = await connect(`${BASE}/ws?plaza=1`, '广场乙');
  const lan = await connect(`${BASE}/ws`, '局域网');
  try {
    assert.ok(a.welcome.plaza >= 1);
    assert.strictEqual(a.welcome.room, '');
    assert.ok(a.welcome.maxFileBytes > 0 && a.welcome.maxFileBytes <= 20 * 1024 * 1024);
    assert.ok(b.welcome.peers.some((p) => p.id === a.id));
    assert.ok(!lan.welcome.peers.some((p) => p.id === a.id || p.id === b.id));
    assert.ok(!b.welcome.peers.some((p) => p.id === lan.id));
    // Signals for a direct link are dropped: it would show strangers each other's IP address.
    a.send({ type: 'signal', to: b.id, data: { candidate: { candidate: 'x' } } });
    await assert.rejects(b.wait((m) => m.type === 'signal', 500));
  } finally {
    await Promise.all([a.close(), b.close(), lan.close()]);
  }
});

test('in the plaza a receiver is asked first, and gets nothing before it says yes', opts, async () => {
  const a = await connect(`${BASE}/ws?plaza=1`, '发');
  const b = await connect(`${BASE}/ws?plaza=1`, '收');
  const c = await connect(`${BASE}/ws?plaza=1`, '不理');
  try {
    const id = crypto.randomUUID();
    a.send({ type: 'file-start', transferId: id, to: [b.id, c.id], name: 'a.txt', size: 4 });
    const acc = await a.wait((m) => m.type === 'file-accepted' && m.transferId === id);
    assert.strictEqual(acc.ask, true);
    assert.strictEqual((await b.wait((m) => m.type === 'file-start' && m.transferId === id)).ask, true);
    await c.wait((m) => m.type === 'file-start' && m.transferId === id);

    b.send({ type: 'file-answer', transferId: id, accept: true });
    const yes = await a.wait((m) => m.type === 'file-answer' && m.transferId === id);
    assert.deepStrictEqual([yes.from, yes.accept], [b.id, true]);

    // c has not answered: the chunk reaches b only.
    a.ws.send(Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from('abcd')]));
    const chunk = await b.wait((m) => m.binary);
    assert.strictEqual(chunk.binary.subarray(36).toString(), 'abcd');
    await assert.rejects(c.wait((m) => m.binary, 500));

    // A yes after sending began is too late.
    c.send({ type: 'file-answer', transferId: id, accept: true });
    await c.wait((m) => m.type === 'file-cancel' && m.transferId === id);
    const late = await a.wait((m) => m.type === 'file-answer' && m.transferId === id);
    assert.deepStrictEqual([late.from, late.accept], [c.id, false]);

    a.send({ type: 'file-end', transferId: id });
    await b.wait((m) => m.type === 'file-end' && m.transferId === id);

    // A no: the sender hears it.
    const id2 = crypto.randomUUID();
    a.send({ type: 'file-start', transferId: id2, to: [b.id], name: 'b.txt', size: 1 });
    await b.wait((m) => m.type === 'file-start' && m.transferId === id2);
    b.send({ type: 'file-answer', transferId: id2, accept: false });
    const no = await a.wait((m) => m.type === 'file-answer' && m.transferId === id2);
    assert.strictEqual(no.accept, false);
  } finally {
    await Promise.all([a.close(), b.close(), c.close()]);
  }
});

test('a plaza offer survives a quiet wait before the answer', opts, async () => {
  // Nobody sends anything while a person decides; an idle Hub would otherwise sleep and forget the offer.
  const a = await connect(`${BASE}/ws?plaza=1`, '等');
  const b = await connect(`${BASE}/ws?plaza=1`, '想想');
  try {
    const id = crypto.randomUUID();
    a.send({ type: 'file-start', transferId: id, to: [b.id], name: 'slow.txt', size: 2 });
    await b.wait((m) => m.type === 'file-start' && m.transferId === id);
    await new Promise((r) => setTimeout(r, 15000));
    b.send({ type: 'file-answer', transferId: id, accept: true });
    assert.strictEqual((await a.wait((m) => m.type === 'file-answer' && m.transferId === id)).accept, true);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test('in the plaza one device offers at most 20 files a minute', opts, async () => {
  const a = await connect(`${BASE}/ws?plaza=1`, '刷屏');
  const b = await connect(`${BASE}/ws?plaza=1`, '被刷');
  try {
    const ids = Array.from({ length: 21 }, () => crypto.randomUUID());
    for (const id of ids) a.send({ type: 'file-start', transferId: id, to: [b.id], name: 'x', size: 1 });
    for (const id of ids.slice(0, 20)) await a.wait((m) => m.type === 'file-accepted' && m.transferId === id);
    const rej = await a.wait((m) => m.type === 'file-rejected' && m.transferId === ids[20]);
    assert.strictEqual(rej.reason, 'rate');
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test('a room keeps its own list', opts, async () => {
  const r = room();
  const a = await connect(`${BASE}/ws?room=${r}`, '甲');
  const b = await connect(`${BASE}/ws?room=${r}`, '乙');
  const outside = await connect(`${BASE}/ws?room=${room()}`, '丙');
  try {
    assert.strictEqual(a.welcome.room, r);
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
