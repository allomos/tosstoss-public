'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const https = require('https');
const { startServer, connect } = require('./helpers');

test('devices discover each other and see joins, renames and leaves', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.url, '甲', 'desktop');
    assert.deepStrictEqual(a.welcome.peers, []);
    const b = await connect(s.url, '乙', 'mobile');
    assert.deepStrictEqual(b.welcome.peers, [{ id: a.id, name: '甲', device: 'desktop' }]);
    const joined = await a.wait((m) => m.type === 'peer-joined');
    assert.deepStrictEqual(joined.peer, { id: b.id, name: '乙', device: 'mobile' });

    b.send({ type: 'rename', name: '  新名字  ' });
    const upd = await a.wait((m) => m.type === 'peer-updated');
    assert.strictEqual(upd.peer.name, '新名字');

    await b.close();
    const left = await a.wait((m) => m.type === 'peer-left');
    assert.strictEqual(left.id, b.id);
    await a.close();
  } finally {
    await s.close();
  }
});

test('serves the page and refuses paths outside public/', async () => {
  const s = await startServer();
  try {
    const { base } = s;
    const get = (p) => new Promise((r) => (base.startsWith('https') ? https : http).get(base + p, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => r({ status: res.statusCode, body: b })); }));
    const page = await get('/');
    assert.strictEqual(page.status, 200);
    assert.match(page.body, /<h1><span data-i18n="brand">/);
    const bad = await get('/..%2fserver.js');
    assert.notStrictEqual(bad.status, 200);
  } finally {
    await s.close();
  }
});

test('signals for a direct link reach only the named device, marked with the sender', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.url, '甲');
    const b = await connect(s.url, '乙');
    const c = await connect(s.url, '丙');
    a.send({ type: 'signal', to: b.id, data: { description: { type: 'offer', sdp: 'x' } } });
    const got = await b.wait((m) => m.type === 'signal');
    assert.deepStrictEqual(got, { type: 'signal', from: a.id, data: { description: { type: 'offer', sdp: 'x' } } });
    await assert.rejects(c.wait((m) => m.type === 'signal', 300));
    // Too big, or to oneself: dropped.
    a.send({ type: 'signal', to: b.id, data: { sdp: 'x'.repeat(20000) } });
    a.send({ type: 'signal', to: a.id, data: {} });
    await assert.rejects(b.wait((m) => m.type === 'signal', 300));
    await assert.rejects(a.wait((m) => m.type === 'signal', 300));
    await Promise.all([a.close(), b.close(), c.close()]);
  } finally {
    await s.close();
  }
});
