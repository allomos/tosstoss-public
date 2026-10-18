'use strict';
// File transfer: directly between devices when a direct link opens (direct.js), else through the server.
// Sending: file-start → binary chunks (36-char transfer ID + bytes) → file-end; receivers ack as they go.
// The same messages travel both ways, so one send loop serves direct and relayed receivers together.
// Receiving is automatic: every announced file is collected and saved without asking.
(function () {
  const CHUNK = 256 * 1024;
  const ID_LEN = 36;
  const HIGH_WATER = 4 * 1024 * 1024; // pause sending while this much waits in the socket
  const WINDOW = 8 * 1024 * 1024; // at most this much sent but not yet confirmed by every receiver
  const STALL_MS = 60000;
  const ACK_EVERY = 1024 * 1024;
  const COLLAPSE_AT = 32 * 1024 * 1024; // merge received parts into a Blob every 32 MB
  const DIRECT_WAIT = 5000; // how long to try a direct link before using the server
  const DIRECT_HIGH = 1024 * 1024; // pause while this much waits in a direct channel

  /** @type {Map<string, object>} */
  const items = new Map(); // transfer records shown in the list, newest first
  const incoming = new Map(); // transferId -> receive state
  const queue = []; // outgoing jobs waiting to be sent
  let sending = null;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // crypto.randomUUID needs a secure context (https); LAN pages are plain http.
  function uuid() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const ws = () => {
    // App keeps the socket; reach it through sendJSON for text, and this for binary.
    return Transfer._socket && Transfer._socket();
  };

  // ---------- list rendering ----------
  const t = (k, v) => I18n.t(k, v);
  // Errors are kept as message keys, so the list follows a language switch.
  const peerLabel = (it) => (it.dir === 'in' ? it.peer : it.names.join(t('sep')));

  function render() {
    const { el, esc, fmtSize } = App;
    const list = [...items.values()].reverse();
    el.transfersCard.hidden = list.length === 0;
    el.transfers.innerHTML = list.map((it) => {
      const pct = it.size ? Math.min(100, Math.floor((it.done / it.size) * 100)) : (it.status === 'done' ? 100 : 0);
      const who = esc(t(it.dir === 'in' ? 'tx.from' : 'tx.to', { who: peerLabel(it) }));
      let meta;
      if (it.status === 'done') meta = `${fmtSize(it.size)} · ${who} · ${t(it.dir === 'in' ? 'tx.received' : 'tx.delivered')}`;
      else if (it.status === 'failed') meta = `${who} · ${esc(t(it.error || 'tx.failed', it.errorVars))}`;
      else if (it.status === 'queued') meta = `${fmtSize(it.size)} · ${who} · ${t('tx.queued')}`;
      else meta = `${fmtSize(it.done)} / ${fmtSize(it.size)} · ${who} · ${pct}%`;
      if (it.route && (it.status === 'done' || it.status === 'sending' || it.status === 'receiving')) meta += ` · ${t('tx.' + it.route)}`;
      let actions = '';
      if (it.url) {
        actions = `${it.thumb ? `<img class="thumb" src="${it.url}" alt="">` : ''}<a class="save-btn" href="${it.url}" download="${esc(it.name)}">${t('save')}</a>`;
      } else if (it.dir === 'out' && (it.status === 'sending' || it.status === 'queued')) {
        actions = `<button class="icon-btn" type="button" data-cancel="${it.id}" aria-label="${t('cancelSend')}">✕</button>`;
      }
      return `<li class="file ${it.status}">
        <span class="file-name"><span class="dir ${it.dir}">${it.dir === 'in' ? '↓' : '↑'}</span>${esc(it.name)}</span>
        <span class="file-meta">${meta}</span>
        <span class="file-actions">${actions}</span>
        ${it.status === 'done' && it.missed ? it.missed.map((m) => `<span class="not-got">${esc(t('tx.missed', { peer: m.name, why: t(m.key, m.vars) }))}</span>`).join('') : ''}
        ${it.status === 'done' && it.dir === 'in' ? '' : `<span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>`}
      </li>`;
    }).join('');
  }
  let renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    // A timer rather than animation frames: frames pause in background tabs.
    setTimeout(() => { renderPending = false; render(); }, 100);
  }

  // ---------- sending ----------
  function send(files, to, names) {
    for (const file of files) {
      const id = uuid();
      const item = { id, dir: 'out', name: file.name, size: file.size, done: 0, status: 'queued', names: [...names], allNames: [...names], to: [...to], failed: [], missed: [] };
      items.set(id, item);
      queue.push({ id, file, item });
    }
    render();
    pump();
  }

  async function pump() {
    if (sending || !queue.length) return;
    sending = queue.shift();
    try {
      await sendOne(sending);
    } catch (e) {
      fail(sending.item, 'err.interrupted');
    }
    sending = null;
    pump();
  }

  function fail(item, msg, vars) {
    if (item.status === 'done') return;
    item.status = 'failed';
    item.error = msg;
    item.errorVars = vars;
    scheduleRender();
  }

  // A receiver that will not get this file, and why (shown in the transfer list).
  function miss(item, peer, key, vars) {
    if (item.failed.includes(peer)) return;
    item.failed.push(peer);
    const i = item.to.indexOf(peer);
    item.missed.push({ name: i >= 0 ? item.allNames[i] : App.peerName(peer), key, vars });
  }

  // Wake the sending loop when an ack, a failure or a cancel arrives.
  let wake = null;
  function poke() { if (wake) { const w = wake; wake = null; w(); } }
  function nap(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { wake = null; resolve(); }, ms);
      wake = () => { clearTimeout(t); resolve(); };
    });
  }

  // Bytes every remaining receiver has confirmed: the real delivery progress.
  function delivered(item) {
    const vals = [...item.acks.values()];
    return vals.length ? Math.min(...vals) : 0;
  }

  function finishOut(item) {
    if (item.status !== 'sending') return;
    if (item.acks.size && delivered(item) >= item.size && item.ended) {
      item.done = item.size;
      item.status = 'done';
      if (item.failed.length) item.names = item.names.filter((n, i) => !item.failed.includes(item.to[i]));
      scheduleRender();
      poke();
    }
  }

  // Receivers still taking part through the server (not directly).
  const relayLive = (item) => [...item.acks.keys()].some((p) => !item.direct.has(p));

  function setRoute(item) {
    const direct = [...item.acks.keys()].filter((p) => item.direct.has(p)).length;
    item.route = !direct ? 'relay' : direct === item.acks.size ? 'direct' : 'mixed';
  }

  // A control message to every receiver, each the way it gets the file.
  function tell(item, msg) {
    if (relayLive(item)) App.sendJSON(msg);
    for (const p of item.direct) if (item.acks.has(p)) Direct.send(p, JSON.stringify(msg));
  }

  function directBusy(item) {
    for (const p of item.direct) if (item.acks.has(p) && Direct.buffered(p) >= DIRECT_HIGH) return true;
    return false;
  }

  function frame(idBytes, bytes) {
    const f = new Uint8Array(ID_LEN + bytes.byteLength);
    f.set(idBytes, 0);
    f.set(bytes, ID_LEN);
    return f;
  }

  // Send while every receiver keeps up: at most WINDOW bytes beyond what the slowest confirmed,
  // and never more than HIGH_WATER waiting in the server socket (DIRECT_HIGH in a direct channel).
  async function sendOne(job) {
    const { id, file, item } = job;
    if (item.status === 'failed') return;
    const sock = ws();
    if (!sock || sock.readyState !== WebSocket.OPEN) return fail(item, 'err.notConnected');
    item.status = 'sending';
    item.acks = new Map();
    item.direct = new Set();
    item.failed = [];
    item.missed = [];
    item.sent = 0;
    scheduleRender();

    // Direct links first; whoever cannot be reached directly gets the file through the server.
    const chans = await Promise.all(item.to.map((p) => Direct.open(p, DIRECT_WAIT)));
    if (item.status !== 'sending') return;
    const relayTo = [];
    const start = { type: 'file-start', transferId: id, name: file.name, size: file.size, mime: file.type };
    item.to.forEach((p, i) => {
      if (chans[i] && Direct.send(p, JSON.stringify({ ...start, fromName: Identity.name }))) {
        item.direct.add(p);
        item.acks.set(p, 0);
      } else relayTo.push(p);
    });
    // The server takes files only up to its limit; a bigger one reaches direct receivers only.
    const max = App.maxFile();
    if (max && file.size > max && relayTo.length) {
      if (!item.acks.size) return fail(item, 'err.tooLargeRelay', { max: App.fmtMax() });
      for (const p of relayTo) miss(item, p, 'why.tooLarge', { max: App.fmtMax() });
      const peers = item.to.map((p, i) => (relayTo.includes(p) ? item.names[i] : null)).filter(Boolean).join(t('sep'));
      App.toast(t('toast.relayTooLarge', { peers, file: file.name, max: App.fmtMax() }));
      relayTo.length = 0;
    }
    if (relayTo.length) {
      item.accepted = false;
      App.sendJSON({ ...start, to: relayTo });
      const started = Date.now();
      while (!item.accepted && item.status === 'sending') {
        if (Date.now() - started > 15000) return abort(item, 'err.noServer');
        await nap(1000);
      }
      if (item.status !== 'sending') return;
    }
    if (!item.acks.size) return fail(item, 'err.peerOffline');
    setRoute(item);
    scheduleRender();

    const idBytes = enc.encode(id);
    let lastProgress = Date.now();
    let lastDelivered = 0;
    while (item.sent < file.size) {
      if (item.status !== 'sending') return;
      const relay = relayLive(item);
      if (relay && sock.readyState !== WebSocket.OPEN) return fail(item, 'err.disconnected');
      const d = delivered(item);
      if (d > lastDelivered) { lastDelivered = d; lastProgress = Date.now(); }
      const ahead = item.sent - d >= WINDOW;
      if (ahead || (relay && sock.bufferedAmount >= HIGH_WATER) || directBusy(item)) {
        if (Date.now() - lastProgress > STALL_MS) return abort(item, 'err.stalled');
        await nap(ahead ? 1000 : 20);
        continue;
      }
      const bytes = new Uint8Array(await file.slice(item.sent, item.sent + CHUNK).arrayBuffer());
      if (relay) sock.send(frame(idBytes, bytes));
      for (const p of item.direct) {
        if (!item.acks.has(p)) continue;
        // A data channel takes smaller messages than the server socket: split the chunk.
        const step = Direct.maxMessage(p) - ID_LEN;
        for (let o = 0; o < bytes.byteLength; o += step) Direct.send(p, frame(idBytes, bytes.subarray(o, o + step)));
      }
      item.sent += bytes.byteLength;
    }
    tell(item, { type: 'file-end', transferId: id });
    item.ended = true;
    finishOut(item);
    // Wait for the last confirmations so the next file starts after this one is through.
    while (item.status === 'sending') {
      if (relayLive(item) && sock.readyState !== WebSocket.OPEN) return fail(item, 'err.disconnected');
      if (Date.now() - lastProgress > STALL_MS) return fail(item, 'err.stalled');
      const d = delivered(item);
      if (d > lastDelivered) { lastDelivered = d; lastProgress = Date.now(); }
      await nap(1000);
    }
  }

  function abort(item, msg) {
    tell(item, { type: 'file-cancel', transferId: item.id });
    fail(item, msg);
  }

  function onAccepted(msg) {
    const item = items.get(msg.transferId);
    if (!item || item.dir !== 'out' || !item.acks || item.accepted !== false) return;
    item.accepted = true;
    for (const pid of msg.to) item.acks.set(pid, 0);
    for (const pid of item.to) if (!item.direct.has(pid) && !msg.to.includes(pid)) miss(item, pid, 'why.offline');
    poke();
  }

  function onAck(msg) {
    const item = items.get(msg.transferId);
    if (!item || !item.acks || !item.acks.has(msg.from)) return;
    item.acks.set(msg.from, Math.max(item.acks.get(msg.from), msg.bytes));
    item.done = delivered(item);
    scheduleRender();
    finishOut(item);
    poke();
  }

  function onFailed(msg, toastKey = 'toast.peerLeft') {
    const item = items.get(msg.transferId);
    if (!item || !item.acks || !item.acks.has(msg.peer)) return;
    item.acks.delete(msg.peer);
    miss(item, msg.peer, toastKey === 'toast.directLost' ? 'why.directLost' : 'why.left');
    if (!item.acks.size) fail(item, 'err.peerOffline');
    else { item.done = delivered(item); setRoute(item); finishOut(item); }
    App.toast(t(toastKey, { peer: App.peerName(msg.peer), file: item.name }));
    scheduleRender();
    poke();
  }

  // A direct link ended: its receiver misses the file being sent, and a file coming over it fails.
  function directClosed(peer) {
    if (sending && sending.item.direct && sending.item.direct.has(peer) && sending.item.status === 'sending') {
      onFailed({ transferId: sending.id, peer }, 'toast.directLost');
    }
    for (const [id, rx] of [...incoming]) {
      if (rx.via !== peer) continue;
      incoming.delete(id);
      fail(rx.item, 'err.disconnected');
    }
  }

  // A direct link that a transfer is using right now, so it must stay open.
  function linkBusy(peer) {
    if (sending && sending.item.direct && sending.item.direct.has(peer) && sending.item.status === 'sending') return true;
    for (const rx of incoming.values()) if (rx.via === peer) return true;
    return false;
  }

  // The server refuses files over its size limit (and senders that send more than they announced).
  function onRejected(msg) {
    const item = items.get(msg.transferId);
    if (!item || item.dir !== 'out') return;
    fail(item, 'err.tooLarge');
    poke();
  }

  function cancel(id) {
    const item = items.get(id);
    if (!item || item.dir !== 'out') return;
    const qi = queue.findIndex((j) => j.id === id);
    if (qi >= 0) queue.splice(qi, 1);
    else if (item.acks && item.acks.size) tell(item, { type: 'file-cancel', transferId: id });
    fail(item, 'err.cancelled');
    poke();
  }

  // ---------- receiving (always automatic) ----------
  // `via` is the device a direct link comes from; null when the server relays the file.
  function onStart(msg, via) {
    if (typeof msg.transferId !== 'string' || msg.transferId.length !== ID_LEN || incoming.has(msg.transferId)) return;
    const size = Math.max(0, Number(msg.size) || 0);
    const item = {
      id: msg.transferId, dir: 'in', name: String(msg.name || 'file').slice(0, 255), size, done: 0, status: 'receiving',
      peer: App.peerName(msg.from, msg.fromName), route: via ? 'direct' : 'relay',
    };
    items.set(item.id, item);
    incoming.set(item.id, { item, via, mime: String(msg.mime || '').slice(0, 100), parts: [], blobs: [], pending: 0, acked: 0 });
    scheduleRender();
  }

  // Acks go back the way the file comes.
  function reply(rx, msg) {
    if (rx.via) Direct.send(rx.via, JSON.stringify(msg));
    else App.sendJSON(msg);
  }

  function onChunk(buf, via = null) {
    if (buf.byteLength < ID_LEN) return;
    const id = dec.decode(new Uint8Array(buf, 0, ID_LEN));
    const rx = incoming.get(id);
    if (!rx || rx.via !== via) return;
    const data = buf.slice(ID_LEN);
    rx.parts.push(data);
    rx.pending += data.byteLength;
    rx.item.done += data.byteLength;
    if (rx.pending >= COLLAPSE_AT) {
      rx.blobs.push(new Blob(rx.parts));
      rx.parts = [];
      rx.pending = 0;
    }
    if (rx.item.done - rx.acked >= ACK_EVERY) {
      rx.acked = rx.item.done;
      reply(rx, { type: 'ack', transferId: id, bytes: rx.acked });
    }
    scheduleRender();
  }

  function onEnd(msg, via) {
    const rx = incoming.get(msg.transferId);
    if (!rx || rx.via !== via) return;
    incoming.delete(msg.transferId);
    const { item } = rx;
    reply(rx, { type: 'ack', transferId: msg.transferId, bytes: item.done });
    const blob = new Blob([...rx.blobs, ...rx.parts], { type: rx.mime || 'application/octet-stream' });
    if (blob.size !== item.size) return fail(item, 'err.incomplete');
    item.url = URL.createObjectURL(blob);
    item.thumb = /^image\//.test(rx.mime);
    item.done = item.size;
    item.status = 'done';
    render();
    autoSave(item);
    App.toast(t(Identity.device === 'desktop' ? 'toast.received' : 'toast.receivedTap', { file: item.name }));
  }

  // Receiving is automatic: start the browser's download right away.
  // Some phone browsers block downloads that no tap started; the 保存 button stays as a fallback.
  function autoSave(item) {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    try { a.click(); } catch { /* keep the 保存 button */ }
    a.remove();
  }

  function onCancel(msg, via) {
    const rx = incoming.get(msg.transferId);
    if (!rx || rx.via !== via) return;
    incoming.delete(msg.transferId);
    fail(rx.item, 'err.peerCancelled');
  }

  // ---------- public ----------
  window.Transfer = {
    _socket: null,
    init() {
      App.el.transfers.addEventListener('click', (e) => {
        const id = e.target.dataset.cancel;
        if (id) cancel(id);
      });
      // Messages over a direct link: the same ones, from that device only.
      Direct.onMessage((peer, data) => {
        if (typeof data !== 'string') { onChunk(data, peer); return; }
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (!msg || typeof msg !== 'object') return;
        msg.from = peer;
        switch (msg.type) {
          case 'file-start': onStart(msg, peer); break;
          case 'file-end': onEnd(msg, peer); break;
          case 'file-cancel': onCancel(msg, peer); break;
          case 'ack': onAck(msg); break;
        }
      });
      Direct.onClosed(directClosed);
      Direct.onDrain(poke);
    },
    send,
    linkBusy,
    handle(msg) {
      switch (msg.type) {
        case 'file-start': onStart(msg, null); break;
        case 'file-end': onEnd(msg, null); break;
        case 'file-cancel': onCancel(msg, null); break;
        case 'file-accepted': onAccepted(msg); break;
        case 'ack': onAck(msg); break;
        case 'file-failed': onFailed(msg); break;
        case 'file-rejected': onRejected(msg); break;
      }
    },
    handleBinary: (buf) => onChunk(buf, null),
    render,
    connectionLost() {
      for (const rx of incoming.values()) fail(rx.item, 'err.disconnected');
      incoming.clear();
      for (const job of queue.splice(0)) fail(job.item, 'err.disconnected');
      if (sending) fail(sending.item, 'err.disconnected');
      Direct.reset();
      poke();
    },
    clearFinished() {
      for (const [id, it] of items) {
        if (it.status === 'done' || it.status === 'failed') {
          if (it.url) URL.revokeObjectURL(it.url);
          items.delete(id);
        }
      }
      render();
    },
  };
})();
