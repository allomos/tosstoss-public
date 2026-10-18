'use strict';
// 投桃 Tosstoss — LAN file sharing server.
// Serves the web page and keeps the list of online devices over WebSocket.
// Every browser that opens the page connects here, so devices find each other.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_NAME = 32;
const MAX_SIGNAL = 16 * 1024; // one offer, answer or ICE candidate

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function cleanName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME);
  return s || '未命名设备';
}

function cleanDevice(device) {
  return device === 'mobile' || device === 'tablet' ? device : 'desktop';
}

function createServer() {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 * 1024 });
  /** @type {Map<string, {id:string, name:string, device:string, ws:import('ws')}>} */
  const peers = new Map();

  const info = (p) => ({ id: p.id, name: p.name, device: p.device });
  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg, exceptId) => {
    for (const p of peers.values()) if (p.id !== exceptId) send(p.ws, msg);
  };

  // ----- File relay -----
  // A sender announces a file (file-start) to the devices it picked, then sends binary
  // chunks and file-end. Every binary chunk starts with the 36-character transfer ID.
  // The server forwards each chunk to the transfer's receivers that are still online.
  /** @type {Map<string, {id:string, from:string, to:Set<string>}>} */
  const transfers = new Map();
  const ID_LEN = 36;
  const validId = (t) => typeof t === 'string' && /^[0-9a-f-]{36}$/i.test(t);

  function relayControl(me, msg) {
    const t = transfers.get(msg.transferId);
    switch (msg.type) {
      case 'signal':
        // Connection details for a direct (WebRTC) link between two devices; the file then skips the server.
        if (typeof msg.to !== 'string' || msg.to === me.id || JSON.stringify(msg.data || null).length > MAX_SIGNAL) return;
        server.sendTo(msg.to, { type: 'signal', from: me.id, data: msg.data });
        return;
      case 'file-start': {
        if (!validId(msg.transferId) || transfers.has(msg.transferId) || !Array.isArray(msg.to)) return;
        const to = new Set(msg.to.filter((id) => id !== me.id && peers.has(id)));
        const size = Math.max(0, Number(msg.size) || 0);
        const file = {
          type: 'file-start', transferId: msg.transferId, from: me.id,
          name: String(msg.name || 'file').slice(0, 255), size, mime: String(msg.mime || '').slice(0, 100),
        };
        transfers.set(msg.transferId, { id: msg.transferId, from: me.id, to, size, ended: false, pending: new Set(to) });
        for (const id of to) server.sendTo(id, file);
        send(me.ws, { type: 'file-accepted', transferId: msg.transferId, to: [...to] });
        if (!to.size) transfers.delete(msg.transferId);
        return;
      }
      case 'file-end':
        // Keep the transfer until every receiver confirmed the last byte, so their acks still reach the sender.
        if (!t || t.from !== me.id || t.ended) return;
        t.ended = true;
        for (const id of t.to) server.sendTo(id, { type: 'file-end', transferId: t.id });
        if (!t.pending.size) transfers.delete(t.id);
        return;
      case 'file-cancel':
        if (!t || t.from !== me.id) return;
        for (const id of t.to) server.sendTo(id, { type: 'file-cancel', transferId: t.id });
        transfers.delete(t.id);
        return;
      case 'ack': {
        // A receiver reports how many bytes it has; the sender uses it for progress and pacing.
        if (!t || !t.to.has(me.id)) return;
        const bytes = Number(msg.bytes) || 0;
        server.sendTo(t.from, { type: 'ack', transferId: t.id, from: me.id, bytes });
        if (bytes >= t.size) t.pending.delete(me.id);
        if (t.ended && !t.pending.size) transfers.delete(t.id);
        return;
      }
    }
  }

  function relayChunk(me, data) {
    if (data.length < ID_LEN) return;
    const t = transfers.get(data.toString('latin1', 0, ID_LEN));
    if (!t || t.from !== me.id || t.ended) return;
    for (const id of t.to) {
      const p = peers.get(id);
      if (p && p.ws.readyState === p.ws.OPEN) p.ws.send(data, { binary: true });
    }
  }

  function relayLeft(me) {
    for (const t of [...transfers.values()]) {
      if (t.from === me.id) {
        for (const id of t.to) server.sendTo(id, { type: 'file-cancel', transferId: t.id });
        transfers.delete(t.id);
      } else if (t.to.delete(me.id)) {
        t.pending.delete(me.id);
        server.sendTo(t.from, { type: 'file-failed', transferId: t.id, peer: me.id });
        if (!t.to.size || (t.ended && !t.pending.size)) transfers.delete(t.id);
      }
    }
  }

  wss.on('connection', (ws) => {
    let me = null;
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (me) relayChunk(me, data);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'hello' && !me) {
        me = { id: crypto.randomUUID(), name: cleanName(msg.name), device: cleanDevice(msg.device), ws };
        send(ws, { type: 'welcome', id: me.id, peers: [...peers.values()].map(info), urls: server.urls || [] });
        peers.set(me.id, me);
        broadcast({ type: 'peer-joined', peer: info(me) }, me.id);
        return;
      }
      if (!me) return;
      if (msg.type === 'rename') {
        me.name = cleanName(msg.name);
        broadcast({ type: 'peer-updated', peer: info(me) }, me.id);
        return;
      }
      relayControl(me, msg);
    });

    ws.on('close', () => {
      if (!me) return;
      peers.delete(me.id);
      broadcast({ type: 'peer-left', id: me.id });
      relayLeft(me);
    });
  });

  // Drop connections that stopped answering (e.g. a phone that went to sleep).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);
  server.on('close', () => clearInterval(heartbeat));

  server.peers = peers;
  server.sendTo = (id, msg) => {
    const p = peers.get(id);
    if (p) send(p.ws, msg);
    return !!p;
  };
  return server;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

module.exports = { createServer, lanAddresses };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log('投桃 Tosstoss 已启动。在同一局域网的电脑或手机浏览器中打开：');
    server.urls = lanAddresses().map((a) => `http://${a}:${port}`);
    for (const u of server.urls) console.log(`  ${u}`);
    if (!server.urls.length) console.log(`  http://localhost:${port}`);
  });
}
