'use strict';
// A 200 MB file to two receivers, with the page's pacing: the sender keeps at most WINDOW bytes
// beyond what the slowest receiver confirmed. Receivers hash as they go, like a page keeps Blobs.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { startServer, connect } = require('./helpers');

const SIZE = 200 * 1024 * 1024;
const CHUNK = 256 * 1024;
const WINDOW = 8 * 1024 * 1024;
const ACK_EVERY = 1024 * 1024;

function receiver(client) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let id = null, got = 0, acked = 0;
    client.ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const m = JSON.parse(data.toString());
        if (m.type === 'file-start') id = m.transferId;
        if (m.type === 'file-end') { client.send({ type: 'ack', transferId: id, bytes: got }); resolve({ got, digest: hash.digest('hex') }); }
        if (m.type === 'file-cancel') reject(new Error('cancelled'));
        return;
      }
      const part = data.subarray(36);
      hash.update(part);
      got += part.length;
      if (got - acked >= ACK_EVERY) { acked = got; client.send({ type: 'ack', transferId: id, bytes: got }); }
    });
  });
}

// Deterministic content made on the fly, so the test never holds 200 MB.
function chunkAt(off) {
  const n = Math.min(CHUNK, SIZE - off);
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i += 4) b.writeUInt32LE((off + i) >>> 0, i);
  return b;
}

test('a 200 MB file reaches two receivers intact with paced sending', { timeout: 120000 }, async (ctx) => {
  const s = await startServer();
  try {
    const a = await connect(s.url, 'A');
    // The 20 MB deployment refuses it; internet.test.js covers that.
    if (a.welcome.maxFileBytes && a.welcome.maxFileBytes < SIZE) { await a.close(); ctx.skip(`server limit is ${a.welcome.maxFileBytes} bytes`); return; }
    const b = await connect(s.url, 'B');
    const c = await connect(s.url, 'C');
    const rb = receiver(b), rc = receiver(c);
    const transferId = crypto.randomUUID();
    const acks = new Map([[b.id, 0], [c.id, 0]]);
    let wake = null;
    a.ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(data.toString());
      if (m.type === 'ack') { acks.set(m.from, m.bytes); if (wake) wake(); }
    });
    a.send({ type: 'file-start', transferId, to: [b.id, c.id], name: 'big.bin', size: SIZE });
    await a.wait((m) => m.type === 'file-accepted');
    const want = crypto.createHash('sha256');
    const prefix = Buffer.from(transferId, 'latin1');
    let maxAhead = 0;
    for (let off = 0; off < SIZE; off += CHUNK) {
      while (off - Math.min(...acks.values()) >= WINDOW) await new Promise((r) => { wake = r; setTimeout(r, 50); });
      maxAhead = Math.max(maxAhead, off - Math.min(...acks.values()));
      const part = chunkAt(off);
      want.update(part);
      a.ws.send(Buffer.concat([prefix, part]));
    }
    a.send({ type: 'file-end', transferId });
    const digest = want.digest('hex');
    for (const r of [await rb, await rc]) {
      assert.strictEqual(r.got, SIZE);
      assert.strictEqual(r.digest, digest);
    }
    assert.ok(maxAhead <= WINDOW, 'sender stayed within the window');
    const mem = process.memoryUsage().rss;
    assert.ok(mem < 1024 * 1024 * 1024, `memory stayed bounded (${Math.round(mem / 1048576)} MB)`);
    for (const x of [a, b, c]) await x.close();
  } finally {
    await s.close();
  }
});
