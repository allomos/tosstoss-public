'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { startServer, connect } = require('./helpers');

const CHUNK = 256 * 1024;

// Send a file the way the page does: file-start, chunks prefixed with the transfer ID, file-end.
async function sendFile(sender, to, name, data) {
  const transferId = crypto.randomUUID();
  sender.send({ type: 'file-start', transferId, to, name, size: data.length, mime: 'application/octet-stream' });
  const accepted = await sender.wait((m) => m.type === 'file-accepted' && m.transferId === transferId);
  for (let off = 0; off < data.length; off += CHUNK) {
    sender.ws.send(Buffer.concat([Buffer.from(transferId, 'latin1'), data.subarray(off, off + CHUNK)]));
  }
  sender.send({ type: 'file-end', transferId });
  return { transferId, accepted };
}

// Collect a file the way the page does.
async function receiveFile(rx) {
  const start = await rx.wait((m) => m.type === 'file-start');
  const parts = [];
  for (;;) {
    const m = await rx.wait((x) => x.binary || x.type === 'file-end' || x.type === 'file-cancel', 10000);
    if (m.type === 'file-end') break;
    if (m.type === 'file-cancel') throw new Error('cancelled');
    if (m.binary.toString('latin1', 0, 36) === start.transferId) parts.push(m.binary.subarray(36));
  }
  return { start, data: Buffer.concat(parts) };
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('a file sent to two devices arrives intact at both, and not at a third', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.url, 'A');
    const b = await connect(s.url, 'B');
    const c = await connect(s.url, 'C');
    const d = await connect(s.url, 'D');
    const data = crypto.randomBytes(3 * CHUNK + 12345);
    const rb = receiveFile(b);
    const rc = receiveFile(c);
    const { accepted } = await sendFile(a, [b.id, c.id], '照片.jpg', data);
    assert.deepStrictEqual(accepted.to.sort(), [b.id, c.id].sort());
    for (const r of [await rb, await rc]) {
      assert.strictEqual(r.start.name, '照片.jpg');
      assert.strictEqual(r.start.from, a.id);
      assert.strictEqual(r.start.size, data.length);
      assert.strictEqual(sha(r.data), sha(data));
    }
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!d.inbox.some((m) => m.binary || m.type === 'file-start'), 'unselected device got nothing');
    for (const x of [a, b, c, d]) await x.close();
  } finally {
    await s.close();
  }
});

test('an empty file is delivered too', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.url, 'A');
    const b = await connect(s.url, 'B');
    const rb = receiveFile(b);
    await sendFile(a, [b.id], 'empty.txt', Buffer.alloc(0));
    const r = await rb;
    assert.strictEqual(r.data.length, 0);
    await a.close(); await b.close();
  } finally {
    await s.close();
  }
});

test('an offline device cannot be sent to, and receivers see a cancel when the sender leaves', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.url, 'A');
    const b = await connect(s.url, 'B');
    const c = await connect(s.url, 'C');
    await c.close(); // C went offline
    await a.wait((m) => m.type === 'peer-left' && m.id === c.id);
    const transferId = crypto.randomUUID();
    a.send({ type: 'file-start', transferId, to: [b.id, c.id], name: 'x', size: 10 });
    const acc = await a.wait((m) => m.type === 'file-accepted');
    assert.deepStrictEqual(acc.to, [b.id]);
    await b.wait((m) => m.type === 'file-start');
    await a.close();
    await b.wait((m) => m.type === 'file-cancel' && m.transferId === transferId);
    await b.close();
  } finally {
    await s.close();
  }
});

test('the sender hears acks and failures from receivers', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.url, 'A');
    const b = await connect(s.url, 'B');
    const transferId = crypto.randomUUID();
    a.send({ type: 'file-start', transferId, to: [b.id], name: 'x', size: 10 });
    await b.wait((m) => m.type === 'file-start');
    b.send({ type: 'ack', transferId, bytes: 5 });
    const ack = await a.wait((m) => m.type === 'ack');
    assert.deepStrictEqual(ack, { type: 'ack', transferId, from: b.id, bytes: 5 });
    await b.close();
    const failed = await a.wait((m) => m.type === 'file-failed');
    assert.strictEqual(failed.peer, b.id);
    await a.close();
  } finally {
    await s.close();
  }
});

test('final acks sent after file-end still reach the sender', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.url, 'A');
    const b = await connect(s.url, 'B');
    const rb = receiveFile(b);
    const data = crypto.randomBytes(1000);
    const { transferId } = await sendFile(a, [b.id], 'f', data);
    await rb;
    b.send({ type: 'ack', transferId, bytes: data.length });
    const ack = await a.wait((m) => m.type === 'ack');
    assert.strictEqual(ack.bytes, data.length);
    // After the last byte is confirmed the server forgets the transfer.
    b.send({ type: 'ack', transferId, bytes: data.length });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!a.inbox.some((m) => m.type === 'ack'));
    await a.close(); await b.close();
  } finally {
    await s.close();
  }
});
