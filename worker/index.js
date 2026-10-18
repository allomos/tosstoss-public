// 投桃 Tosstoss — Cloudflare Worker version of server.js.
// The Worker serves public/ and sends every /ws connection to a Hub (a Durable Object).
// One Hub per group: devices behind the same public IP share one, a room code gets its own,
// and the plaza (everyone who chose it, from any network) is split over Hubs of PLAZA_PEERS each.
// The Hub keeps the online list and relays file chunks, like server.js does on a LAN.

const MAX_NAME = 32;
const MAX_SIGNAL = 16 * 1024; // one offer, answer or ICE candidate
const ID_LEN = 36;
const ROOM_RE = /^[A-Z0-9]{4,12}$/;
// The plaza is open to strangers: files are relayed only (no direct links, so no IP addresses
// are shared), at most PLAZA_MAX_FILE each, and a receiver says yes before anything is sent.
const PLAZA_PEERS = 200; // devices per plaza Hub; when one is full, the next one is used
const PLAZA_HUBS = 50;
const PLAZA_MAX_FILE = 20 * 1024 * 1024;
const PLAZA_STARTS = 20; // files one device may offer per minute
const PLAZA_ASK_MS = 65000; // an offer nobody answered is withdrawn (the page itself waits 60 s)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return env.ASSETS.fetch(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    // PAUSED "1" (wrangler.jsonc, or the dashboard's variables): every page shows 投桃暂停服务.
    // Answered here, so no Durable Object wakes up and the pause costs next to nothing.
    if (env.PAUSED === '1') return paused();
    const room = (url.searchParams.get('room') || '').toUpperCase();
    const headers = { ...Object.fromEntries(request.headers), 'X-Tosstoss-Room': ROOM_RE.test(room) ? room : '' };
    if (!ROOM_RE.test(room) && url.searchParams.get('plaza') === '1') {
      // A full plaza Hub answers 503: try the next one.
      for (let n = 1; n <= PLAZA_HUBS; n++) {
        const hub = env.HUB.get(env.HUB.idFromName(`plaza:${n}`));
        const res = await hub.fetch(request, { headers: { ...headers, 'X-Tosstoss-Plaza': String(n) } });
        if (res.status !== 503) return res;
      }
      return new Response('The plaza is full', { status: 503 });
    }
    const group = ROOM_RE.test(room) ? `room:${room}` : `ip:${await hash(networkOf(request.headers.get('CF-Connecting-IP')))}`;
    const hub = env.HUB.get(env.HUB.idFromName(group));
    return hub.fetch(request, { headers });
  },
};

// A socket that only says "paused" and closes; the page then stops reconnecting.
function paused() {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ type: 'paused' }));
  pair[1].close(4003, 'paused');
  return new Response(null, { status: 101, webSocket: pair[0] });
}

// Devices on one network share an IPv4 address, but each gets its own IPv6 address
// inside the network's /64, so group IPv6 by its first four blocks.
function networkOf(ip) {
  if (!ip) return 'local';
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return full.slice(0, 4).map((x) => parseInt(x || '0', 16).toString(16)).join(':') + '::/64';
}

// Keep raw addresses out of Durable Object names.
async function hash(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tosstoss:' + s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME);
  return s || '未命名设备';
}

function cleanDevice(device) {
  return device === 'mobile' || device === 'tablet' ? device : 'desktop';
}

const validId = (t) => typeof t === 'string' && /^[0-9a-f-]{36}$/i.test(t);

// Uses WebSocket hibernation: while nobody sends anything, the Hub sleeps and costs nothing.
// Each socket's device info is stored on the socket itself, so the list survives a sleep.
// Transfers live in memory; a transfer is always busy, so the Hub does not sleep during one.
export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    // Largest file this deployment relays, in bytes; 0 means no limit (MAX_FILE_BYTES in wrangler.jsonc).
    this.maxFile = Math.max(0, Number(env.MAX_FILE_BYTES) || 0);
    /** @type {Map<string, {id:string, from:string, to:Set<string>, size:number, ended:boolean, pending:Set<string>, asking:Set<string>|null}>} */
    this.transfers = new Map();
    this.starts = new Map(); // plaza: device id -> times it offered a file in the last minute
    // The page pings every 25 s to keep phones' connections alive; answer without waking the Hub.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const plaza = Number(request.headers.get('X-Tosstoss-Plaza')) || 0;
    if (plaza && this.ctx.getWebSockets().filter((ws) => ws.readyState === 1).length >= PLAZA_PEERS) {
      return new Response('Full', { status: 503 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ room: request.headers.get('X-Tosstoss-Room') || '', plaza });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // Largest file relayed for this device, in bytes; 0 means no limit.
  limit(me) {
    if (!me.plaza) return this.maxFile;
    return this.maxFile ? Math.min(this.maxFile, PLAZA_MAX_FILE) : PLAZA_MAX_FILE;
  }

  // Plaza only: may this device offer one more file now?
  mayStart(me) {
    if (!me.plaza) return true;
    const now = Date.now();
    const times = (this.starts.get(me.id) || []).filter((x) => now - x < 60000);
    if (times.length >= PLAZA_STARTS) return false;
    times.push(now);
    this.starts.set(me.id, times);
    return true;
  }

  // ---------- peers ----------
  peers() {
    const out = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id && ws.readyState === 1) out.set(a.id, { ...a, ws });
    }
    return out;
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  sendTo(peers, id, msg) {
    const p = peers.get(id);
    if (p) this.send(p.ws, msg);
  }

  broadcast(peers, msg, exceptId) {
    for (const p of peers.values()) if (p.id !== exceptId) this.send(p.ws, msg);
  }

  // ---------- messages ----------
  async webSocketMessage(ws, data) {
    const me = ws.deserializeAttachment() || {};
    if (typeof data !== 'string') {
      if (me.id) this.relayChunk(me, data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    const info = (p) => ({ id: p.id, name: p.name, device: p.device });

    if (msg.type === 'hello' && !me.id) {
      const peers = this.peers();
      const mine = { room: me.room, plaza: me.plaza || 0, id: crypto.randomUUID(), name: cleanName(msg.name), device: cleanDevice(msg.device) };
      ws.serializeAttachment(mine);
      this.send(ws, { type: 'welcome', id: mine.id, peers: [...peers.values()].map(info), urls: [], room: mine.room, plaza: mine.plaza, maxFileBytes: this.limit(mine) });
      this.broadcast(peers, { type: 'peer-joined', peer: info(mine) });
      return;
    }
    if (!me.id) return;
    if (msg.type === 'rename') {
      me.name = cleanName(msg.name);
      ws.serializeAttachment(me);
      this.broadcast(this.peers(), { type: 'peer-updated', peer: info(me) }, me.id);
      return;
    }
    this.relayControl(me, ws, msg);
  }

  async webSocketClose(ws, code) {
    this.left(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {}
  }

  async webSocketError(ws) {
    this.left(ws);
  }

  left(ws) {
    const me = ws.deserializeAttachment();
    if (!me || !me.id || me.gone) return;
    ws.serializeAttachment({ ...me, gone: true, id: null });
    this.starts.delete(me.id);
    const peers = this.peers();
    this.broadcast(peers, { type: 'peer-left', id: me.id });
    for (const t of [...this.transfers.values()]) {
      if (t.from === me.id) {
        for (const id of t.to) this.sendTo(peers, id, { type: 'file-cancel', transferId: t.id });
        this.transfers.delete(t.id);
      } else if (t.to.delete(me.id)) {
        t.pending.delete(me.id);
        if (t.asking) t.asking.delete(me.id);
        this.sendTo(peers, t.from, { type: 'file-failed', transferId: t.id, peer: me.id });
        if (!t.to.size || (t.ended && !t.pending.size)) this.transfers.delete(t.id);
      }
    }
  }

  // ---------- file relay (same protocol as server.js) ----------
  relayControl(me, ws, msg) {
    const t = this.transfers.get(msg.transferId);
    const peers = this.peers();
    switch (msg.type) {
      case 'signal':
        // Connection details for a direct (WebRTC) link between two devices; the file then skips the Hub.
        // Not in the plaza: a direct link would show each stranger the other's IP address.
        if (me.plaza || typeof msg.to !== 'string' || msg.to === me.id || JSON.stringify(msg.data || null).length > MAX_SIGNAL) return;
        this.sendTo(peers, msg.to, { type: 'signal', from: me.id, data: msg.data });
        return;
      case 'file-start': {
        if (!validId(msg.transferId) || this.transfers.has(msg.transferId) || !Array.isArray(msg.to)) return;
        const to = new Set(msg.to.filter((id) => id !== me.id && peers.has(id)));
        const size = Math.max(0, Number(msg.size) || 0);
        const max = this.limit(me);
        if (max && size > max) {
          this.send(ws, { type: 'file-rejected', transferId: msg.transferId, max });
          return;
        }
        if (!this.mayStart(me)) {
          this.send(ws, { type: 'file-rejected', transferId: msg.transferId, reason: 'rate', per: PLAZA_STARTS });
          return;
        }
        const file = {
          type: 'file-start', transferId: msg.transferId, from: me.id, fromName: me.name,
          name: String(msg.name || 'file').slice(0, 255), size, mime: String(msg.mime || '').slice(0, 100),
          // Plaza: the receiver is asked first; nothing reaches it before it says yes (file-answer).
          ...(me.plaza ? { ask: true } : {}),
        };
        this.transfers.set(msg.transferId, {
          id: msg.transferId, from: me.id, to, size, relayed: 0, ended: false, pending: new Set(to), asking: me.plaza ? new Set(to) : null,
        });
        // While an offer waits for people to answer, no messages arrive and the Hub would go to
        // sleep and forget it. A pending timer keeps it awake, and withdraws the offer in the end.
        if (me.plaza && to.size) setTimeout(() => this.expire(msg.transferId), PLAZA_ASK_MS);
        for (const id of to) this.sendTo(peers, id, file);
        this.send(ws, { type: 'file-accepted', transferId: msg.transferId, to: [...to], ...(me.plaza ? { ask: true } : {}) });
        if (!to.size) this.transfers.delete(msg.transferId);
        return;
      }
      case 'file-answer': {
        // Plaza: a receiver takes the offered file or not. A yes after sending began is too late.
        if (!t || !t.asking || !t.asking.delete(me.id)) return;
        const yes = msg.accept === true && !t.relayed;
        if (!yes) {
          if (msg.accept === true) this.send(ws, { type: 'file-cancel', transferId: t.id });
          t.to.delete(me.id);
          t.pending.delete(me.id);
        }
        this.sendTo(peers, t.from, { type: 'file-answer', transferId: t.id, from: me.id, accept: yes });
        if (!t.to.size || (t.ended && !t.pending.size)) this.transfers.delete(t.id);
        return;
      }
      case 'file-end':
        if (!t || t.from !== me.id || t.ended) return;
        t.ended = true;
        // Plaza: whoever never answered does not get the file.
        if (t.asking) {
          for (const id of t.asking) {
            this.sendTo(peers, id, { type: 'file-cancel', transferId: t.id });
            t.to.delete(id);
            t.pending.delete(id);
          }
          t.asking.clear();
        }
        for (const id of t.to) this.sendTo(peers, id, { type: 'file-end', transferId: t.id });
        if (!t.pending.size) this.transfers.delete(t.id);
        return;
      case 'file-cancel':
        if (!t || t.from !== me.id) return;
        for (const id of t.to) this.sendTo(peers, id, { type: 'file-cancel', transferId: t.id });
        this.transfers.delete(t.id);
        return;
      case 'ack': {
        if (!t || !t.to.has(me.id)) return;
        const bytes = Number(msg.bytes) || 0;
        this.sendTo(peers, t.from, { type: 'ack', transferId: t.id, from: me.id, bytes });
        if (bytes >= t.size) t.pending.delete(me.id);
        if (t.ended && !t.pending.size) this.transfers.delete(t.id);
        return;
      }
    }
  }

  // Plaza: receivers that never answered do not get the file; the sender hears it as a no.
  expire(id) {
    const t = this.transfers.get(id);
    if (!t || !t.asking || !t.asking.size) return;
    const peers = this.peers();
    for (const pid of t.asking) {
      this.sendTo(peers, pid, { type: 'file-cancel', transferId: t.id });
      this.sendTo(peers, t.from, { type: 'file-answer', transferId: t.id, from: pid, accept: false });
      t.to.delete(pid);
      t.pending.delete(pid);
    }
    t.asking.clear();
    if (!t.to.size || (t.ended && !t.pending.size)) this.transfers.delete(t.id);
  }

  relayChunk(me, data) {
    const bytes = new Uint8Array(data);
    if (bytes.length < ID_LEN) return;
    const t = this.transfers.get(String.fromCharCode(...bytes.subarray(0, ID_LEN)));
    if (!t || t.from !== me.id || t.ended) return;
    const peers = this.peers();
    // A sender cannot get past the limit by announcing a smaller size than it sends.
    t.relayed += bytes.length - ID_LEN;
    if (t.relayed > t.size) {
      for (const id of t.to) this.sendTo(peers, id, { type: 'file-cancel', transferId: t.id });
      this.sendTo(peers, me.id, { type: 'file-rejected', transferId: t.id, max: this.limit(me) });
      this.transfers.delete(t.id);
      return;
    }
    for (const id of t.to) {
      if (t.asking && t.asking.has(id)) continue;
      const p = peers.get(id);
      if (p) try { p.ws.send(data); } catch {}
    }
  }
}
