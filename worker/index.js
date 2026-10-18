// 投桃 Tosstoss — Cloudflare Worker version of server.js.
// The Worker serves public/ and sends every /ws connection to a Hub (a Durable Object).
// One Hub per group: devices behind the same public IP share one, a room code gets its own.
// The Hub keeps the online list and relays file chunks, like server.js does on a LAN.

const MAX_NAME = 32;
const MAX_SIGNAL = 16 * 1024; // one offer, answer or ICE candidate
const ID_LEN = 36;
const ROOM_RE = /^[A-Z0-9]{4,12}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return env.ASSETS.fetch(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const room = (url.searchParams.get('room') || '').toUpperCase();
    const group = ROOM_RE.test(room) ? `room:${room}` : `ip:${await hash(networkOf(request.headers.get('CF-Connecting-IP')))}`;
    const hub = env.HUB.get(env.HUB.idFromName(group));
    return hub.fetch(request, { headers: { ...Object.fromEntries(request.headers), 'X-Tosstoss-Room': ROOM_RE.test(room) ? room : '' } });
  },
};

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
    /** @type {Map<string, {id:string, from:string, to:Set<string>, size:number, ended:boolean, pending:Set<string>}>} */
    this.transfers = new Map();
    // The page pings every 25 s to keep phones' connections alive; answer without waking the Hub.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ room: request.headers.get('X-Tosstoss-Room') || '' });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---------- peers ----------
  // Everyone connected, hidden ones included: they still get messages and can send.
  peers() {
    const out = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id && ws.readyState === 1) out.set(a.id, { ...a, ws });
    }
    return out;
  }

  // Hidden devices (the default outside rooms) are left out of the list and cannot be sent to.
  visible(peers) {
    return [...peers.values()].filter((p) => !p.hidden);
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
      // In a room everyone is visible: joining it is the choice to be seen.
      const hidden = !me.room && msg.hidden === true;
      const mine = { room: me.room, id: crypto.randomUUID(), name: cleanName(msg.name), device: cleanDevice(msg.device), hidden };
      ws.serializeAttachment(mine);
      this.send(ws, { type: 'welcome', id: mine.id, peers: this.visible(peers).map(info), urls: [], room: mine.room, hidden, maxFileBytes: this.maxFile });
      if (!hidden) this.broadcast(peers, { type: 'peer-joined', peer: info(mine) });
      return;
    }
    if (!me.id) return;
    if (msg.type === 'rename') {
      me.name = cleanName(msg.name);
      ws.serializeAttachment(me);
      if (!me.hidden) this.broadcast(this.peers(), { type: 'peer-updated', peer: info(me) }, me.id);
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
    const peers = this.peers();
    if (!me.hidden) this.broadcast(peers, { type: 'peer-left', id: me.id });
    for (const t of [...this.transfers.values()]) {
      if (t.from === me.id) {
        for (const id of t.to) this.sendTo(peers, id, { type: 'file-cancel', transferId: t.id });
        this.transfers.delete(t.id);
      } else if (t.to.delete(me.id)) {
        t.pending.delete(me.id);
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
        // Hidden devices may be signalled: they start the link, and the other side answers.
        if (typeof msg.to !== 'string' || msg.to === me.id || JSON.stringify(msg.data || null).length > MAX_SIGNAL) return;
        this.sendTo(peers, msg.to, { type: 'signal', from: me.id, data: msg.data });
        return;
      case 'file-start': {
        if (!validId(msg.transferId) || this.transfers.has(msg.transferId) || !Array.isArray(msg.to)) return;
        const to = new Set(msg.to.filter((id) => id !== me.id && peers.has(id) && !peers.get(id).hidden));
        const size = Math.max(0, Number(msg.size) || 0);
        if (this.maxFile && size > this.maxFile) {
          this.send(ws, { type: 'file-rejected', transferId: msg.transferId, max: this.maxFile });
          return;
        }
        const file = {
          // A hidden sender is not in the receiver's list, so send its name along.
          type: 'file-start', transferId: msg.transferId, from: me.id, fromName: me.name,
          name: String(msg.name || 'file').slice(0, 255), size, mime: String(msg.mime || '').slice(0, 100),
        };
        this.transfers.set(msg.transferId, { id: msg.transferId, from: me.id, to, size, relayed: 0, ended: false, pending: new Set(to) });
        for (const id of to) this.sendTo(peers, id, file);
        this.send(ws, { type: 'file-accepted', transferId: msg.transferId, to: [...to] });
        if (!to.size) this.transfers.delete(msg.transferId);
        return;
      }
      case 'file-end':
        if (!t || t.from !== me.id || t.ended) return;
        t.ended = true;
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
      this.sendTo(peers, me.id, { type: 'file-rejected', transferId: t.id, max: this.maxFile });
      this.transfers.delete(t.id);
      return;
    }
    for (const id of t.to) {
      const p = peers.get(id);
      if (p) try { p.ws.send(data); } catch {}
    }
  }
}
