'use strict';
// 投桃 Tosstoss — page logic: connection, online devices, picking files, sending.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = {
    renameBtn: $('renameBtn'), status: $('status'), meName: $('meName'), meIcon: $('meIcon'),
    peers: $('peers'), peersEmpty: $('peersEmpty'), peerCount: $('peerCount'), selectAll: $('selectAll'),
    pageUrl: $('pageUrl'), drop: $('drop'), fileInput: $('fileInput'), picked: $('picked'),
    sendBtn: $('sendBtn'), sendHint: $('sendHint'), transfersCard: $('transfersCard'),
    transfers: $('transfers'), clearDone: $('clearDone'), overlay: $('dragOverlay'), toast: $('toast'),
    langSelect: $('langSelect'), emptyHow: $('emptyHow'), netCard: $('netCard'), netIp: $('netIp'), netRoom: $('netRoom'),
    modeHint: $('modeHint'), modeHiddenOpt: $('modeHiddenOpt'), modePublic: $('modePublic'), createRoom: $('createRoom'), joinRoom: $('joinRoom'),
    roomCode: $('roomCode'), copyRoom: $('copyRoom'), leaveRoom: $('leaveRoom'),
    qrRoom: $('qrRoom'), qrDialog: $('qrDialog'), qrBox: $('qrBox'), qrCode: $('qrCode'), qrLink: $('qrLink'), qrClose: $('qrClose'),
  };
  const t = (k, v) => I18n.t(k, v);

  const ICONS = {
    desktop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    mobile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
    tablet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  };
  const kind = (d) => t('kind.' + (ICONS[d] ? d : 'desktop'));
  const VISIBLE_KEY = 'tosstoss.visible'; // '1' public, else hidden; offline is not kept
  const ROOM_RE = /^[A-Z0-9]{4,12}$/;

  const state = {
    ws: null,
    myId: null,
    wantOnline: true,
    peers: new Map(), // id -> {id, name, device}
    selected: new Set(),
    files: [],
    retry: 0,
    // Internet version only: the server says so in its welcome (it sends a room field).
    net: false,
    room: readRoom(),
    maxFile: 0, // bytes per file; 0 = no limit (the server says in its welcome)
    visible: readVisible(),
  };

  function readRoom() {
    const r = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
    return ROOM_RE.test(r) ? r : '';
  }
  // Default: hidden on the internet; the person turns it on.
  function readVisible() {
    try { return localStorage.getItem(VISIBLE_KEY) === '1'; } catch { return false; }
  }

  // ---------- helpers ----------
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  let toastTimer;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }

  // ---------- connection ----------
  function sendJSON(msg) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) { state.ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  function connect() {
    setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws${state.room ? '?room=' + state.room : ''}`);
    ws.binaryType = 'arraybuffer';
    state.ws = ws;
    ws.onopen = () => {
      state.retry = 0;
      ws.send(JSON.stringify({ type: 'hello', name: Identity.name, device: Identity.device, hidden: !state.visible }));
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) { Transfer.handleBinary(ev.data); return; }
      if (ev.data === 'pong') return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage(msg);
    };
    ws.onclose = () => {
      if (state.ws !== ws) return;
      dropConnection();
      if (state.wantOnline) {
        setStatus('connecting');
        const delay = Math.min(10000, 500 * 2 ** state.retry++);
        setTimeout(() => { if (state.wantOnline && !state.ws) connect(); }, delay);
      } else {
        setStatus('offline');
      }
    };
  }

  function dropConnection() {
    state.ws = null;
    state.myId = null;
    state.peers.clear();
    state.selected.clear();
    Transfer.connectionLost();
    renderPeers();
  }

  // Join another group (a room, or back to the network) or reappear with a new visibility.
  function reconnect() {
    const old = state.ws;
    dropConnection();
    if (old) old.close();
    state.retry = 0;
    if (state.wantOnline) connect();
    else setStatus('offline');
  }

  // Keeps phones' connections from going idle; the server answers "pong" (the LAN server ignores it).
  setInterval(() => { if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send('ping'); }, 25000);

  function onMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        state.myId = msg.id;
        // Opened via localhost? Show the LAN address others should open instead.
        state.lanUrls = msg.urls || [];
        state.net = 'room' in msg;
        state.maxFile = msg.maxFileBytes || 0;
        renderLimit();
        renderNet();
        state.peers = new Map(msg.peers.map((p) => [p.id, p]));
        setStatus('online');
        renderPeers();
        break;
      case 'peer-joined':
      case 'peer-updated':
        state.peers.set(msg.peer.id, msg.peer);
        renderPeers();
        break;
      case 'peer-left':
        state.peers.delete(msg.id);
        state.selected.delete(msg.id);
        renderPeers();
        break;
      case 'signal':
        Direct.handleSignal(msg);
        break;
      default:
        Transfer.handle(msg);
    }
  }

  function setStatus(s) {
    el.status.className = 'status ' + s;
    state.status = s;
    el.status.textContent = t('status.' + s);
    renderMode();
    updateSend();
  }

  // ---------- who can see me: public / hidden / offline ----------
  // Hidden exists only on the internet version, and a room always shows you.
  function renderMode() {
    const hiddenWorks = state.net && !state.room;
    el.modeHiddenOpt.hidden = !state.net;
    el.modeHiddenOpt.querySelector('input').disabled = !hiddenWorks;
    el.modePublic.textContent = t(state.net ? 'mode.public' : 'mode.online');
    const mode = !state.wantOnline ? 'offline' : state.visible || !hiddenWorks ? 'public' : 'hidden';
    for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === mode;
    el.modeHint.textContent = t(
      mode === 'offline' ? 'mode.offlineHint'
        : !state.net ? 'mode.lanHint'
          : state.room ? 'mode.roomHint'
            : mode === 'public' ? 'net.visibleHint' : 'net.hiddenHint');
  }

  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      if (r.value === 'offline') {
        state.wantOnline = false;
        if (state.ws) state.ws.close();
        else setStatus('offline');
        return;
      }
      const visible = r.value === 'public';
      const changed = visible !== state.visible;
      state.visible = visible;
      try { localStorage.setItem(VISIBLE_KEY, visible ? '1' : '0'); } catch {}
      if (!state.wantOnline) {
        state.wantOnline = true;
        connect();
      } else if (changed && !state.room) {
        reconnect();
      }
      renderMode();
    });
  }

  // Phones drop the connection while the page is in the background; reconnect on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.wantOnline) return;
    if (!state.ws || state.ws.readyState > WebSocket.OPEN) { state.ws = null; connect(); }
  });

  // ---------- me ----------
  function renderMe() {
    el.meName.textContent = Identity.name;
    el.meIcon.innerHTML = ICONS[Identity.device];
    el.meIcon.title = kind(Identity.device);
  }

  el.renameBtn.addEventListener('click', () => {
    const input = prompt(t('rename.prompt'), Identity.name);
    if (input === null) return;
    const name = input.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32);
    if (!name || name === Identity.name) return;
    Identity.setName(name);
    renderMe();
    sendJSON({ type: 'rename', name });
    toast(t('toast.renamed', { name }));
  });

  // ---------- direct links to ticked devices ----------
  // While a device is ticked we keep a direct link to it open and show whether files to it go
  // directly or through the server. Unticking ends the link, unless a transfer is using it.
  const PROBE_WAIT = 5000;
  const links = new Map(); // peerId -> 'probing' | 'direct' | 'relay'
  const retries = new Map(); // peerId -> timer of the next attempt after a failed one
  const probeRuns = new Map(); // peerId -> number of the latest attempt (older answers are ignored)

  function setLink(id, st) {
    if (links.get(id) === st) return;
    links.set(id, st);
    renderPeers();
  }

  async function probe(id, force) {
    clearTimeout(retries.get(id));
    retries.delete(id);
    if (!state.selected.has(id)) return;
    if (Direct.isOpen(id)) return setLink(id, 'direct');
    const run = (probeRuns.get(id) || 0) + 1;
    probeRuns.set(id, run);
    setLink(id, 'probing');
    const ch = await Direct.open(id, PROBE_WAIT, force);
    if (!state.selected.has(id) || probeRuns.get(id) !== run) return;
    if (ch) return setLink(id, 'direct');
    setLink(id, 'relay');
    retries.set(id, setTimeout(() => probe(id, true), Direct.RETRY_AFTER));
  }

  function stopProbe(id) {
    clearTimeout(retries.get(id));
    retries.delete(id);
    probeRuns.delete(id);
    links.delete(id);
    if (!Transfer.linkBusy(id)) Direct.close(id);
  }

  // Start probing newly ticked devices, stop for the unticked ones.
  function syncProbes() {
    for (const id of state.selected) if (!links.has(id)) probe(id);
    for (const id of [...links.keys()]) if (!state.selected.has(id)) stopProbe(id);
  }

  // A link opened (perhaps started by the other device) or ended.
  Direct.onStatus((id) => {
    if (!state.selected.has(id)) return;
    if (Direct.isOpen(id)) {
      clearTimeout(retries.get(id));
      retries.delete(id);
      probeRuns.set(id, (probeRuns.get(id) || 0) + 1);
      setLink(id, 'direct');
    } else if (links.get(id) === 'direct') {
      probe(id); // it was open and ended: try again at once
    }
  });

  function linkBadge(id) {
    const st = state.selected.has(id) && links.get(id);
    if (!st) return '';
    const text = st === 'probing' ? t('link.probing')
      : st === 'direct' ? t(state.maxFile ? 'link.directFree' : 'link.direct')
      : state.maxFile ? t('link.relayMax', { max: fmtMax() }) : t('link.relay');
    const again = st === 'probing' ? ''
      : `<button class="st-refresh" type="button" data-recheck="${id}" title="${t('link.recheck')}" aria-label="${t('link.recheck')}">↻</button>`;
    return `<span class="st-wrap"><span class="link-st ${st}">${esc(text)}</span>${again}</span>`;
  }

  // ---------- peers ----------
  function renderPeers() {
    syncProbes();
    const list = [...state.peers.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    el.peerCount.textContent = list.length;
    el.peersEmpty.hidden = list.length > 0;
    el.selectAll.hidden = list.length < 2;
    el.selectAll.textContent = t(list.length && list.every((p) => state.selected.has(p.id)) ? 'selectNone' : 'selectAll');
    el.peers.innerHTML = list.map((p) => {
      const id = 'peer-' + p.id;
      return `<li class="peer">
        <input type="checkbox" id="${id}" data-id="${p.id}" ${state.selected.has(p.id) ? 'checked' : ''}>
        <label for="${id}">
          <span class="dev-icon">${ICONS[p.device] || ICONS.desktop}</span>
          <span class="peer-name">${esc(p.name)}<span class="peer-kind">${kind(p.device)} ${linkBadge(p.id)}</span></span>
          <span class="tick">✓</span>
        </label>
      </li>`;
    }).join('');
    updateSend();
  }

  el.peers.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-recheck]');
    if (!btn) return;
    e.preventDefault(); // checking again never changes the tick
    probe(btn.dataset.recheck, true);
  });
  el.peers.addEventListener('change', (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
    renderPeers();
  });
  el.selectAll.addEventListener('click', () => {
    const all = [...state.peers.keys()];
    if (all.every((id) => state.selected.has(id))) state.selected.clear();
    else all.forEach((id) => state.selected.add(id));
    renderPeers();
  });

  // ---------- picking files ----------
  const fmtMax = () => fmtSize(state.maxFile).replace('.0 ', ' ');
  function renderLimit() {
    document.querySelector('.drop-sub').textContent = state.maxFile ? t('drop.subMax', { max: fmtMax() }) : t('drop.sub');
  }

  // Any size can be picked: the limit applies only when a file has to go through the server,
  // which is known at send time (transfer.js).
  function addFiles(list) {
    const files = [...list];
    if (!files.length) return;
    state.files.push(...files);
    renderPicked();
  }

  function renderPicked() {
    el.picked.innerHTML = state.files.map((f, i) => `<li class="file">
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-meta">${fmtSize(f.size)}</span>
      <span class="file-actions"><button class="icon-btn" type="button" data-i="${i}" aria-label="${esc(t('remove', { name: f.name }))}">✕</button></span>
    </li>`).join('');
    updateSend();
  }

  el.picked.addEventListener('click', (e) => {
    const i = e.target.dataset.i;
    if (i === undefined) return;
    state.files.splice(Number(i), 1);
    renderPicked();
  });

  el.fileInput.addEventListener('change', () => {
    addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });
  el.drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
  });

  // Drop files anywhere on the page; highlight the drop box.
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (dragDepth++ === 0) { el.overlay.hidden = false; el.drop.classList.add('over'); }
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; el.overlay.hidden = true; el.drop.classList.remove('over'); }
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.overlay.hidden = true;
    el.drop.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });
  // Pasting files (e.g. a screenshot) also adds them.
  window.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.files.length) addFiles(e.clipboardData.files);
  });

  // ---------- sending ----------
  function updateSend() {
    const online = !!state.myId;
    const n = state.selected.size;
    el.sendBtn.disabled = !(online && n && state.files.length);
    el.sendBtn.textContent = n ? t('send.btnN', { n }) : t('send.btn');
    if (!online) el.sendHint.textContent = t(state.wantOnline ? 'hint.connecting' : 'hint.offline');
    else if (!state.peers.size) el.sendHint.textContent = t('hint.waiting');
    else if (!n) el.sendHint.textContent = t('hint.pickPeer');
    else if (!state.files.length) el.sendHint.textContent = t('hint.pickFile');
    else el.sendHint.textContent = t('hint.summary', { n: state.files.length, size: fmtSize(state.files.reduce((s, f) => s + f.size, 0)) });
  }

  el.sendBtn.addEventListener('click', () => {
    const to = [...state.selected].filter((id) => state.peers.has(id));
    if (!to.length || !state.files.length) return;
    const names = to.map((id) => state.peers.get(id).name);
    Transfer.send(state.files.slice(), to, names);
    state.files = [];
    renderPicked();
    toast(t('toast.sending', { names: names.join(t('sep')) }));
  });

  // ---------- transfers list ----------
  el.clearDone.addEventListener('click', () => Transfer.clearFinished());

  // ---------- who can see me / rooms (internet version) ----------
  function roomLink() {
    return `${location.origin}${location.pathname}?room=${state.room}`;
  }

  function renderNet() {
    el.netCard.hidden = !state.net;
    // In a room, the room card and everything below it change colour, so it is clear where you are.
    document.body.classList.toggle('in-room', !!state.room);
    el.netIp.hidden = !!state.room;
    el.netRoom.hidden = !state.room;
    renderMode();
    el.roomCode.textContent = state.room;
    // What to open on the other device.
    if (state.room) {
      el.emptyHow.textContent = t('peers.emptyRoom');
      el.pageUrl.textContent = roomLink();
    } else if (state.net) {
      el.emptyHow.textContent = t('peers.emptyNet');
      el.pageUrl.textContent = location.origin;
    } else {
      el.emptyHow.textContent = t('peers.emptyLan');
      // Opened via localhost? Show the LAN address others should open instead.
      const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
      el.pageUrl.textContent = local && state.lanUrls && state.lanUrls.length ? state.lanUrls.join(`  ${t('or')}  `) : location.origin;
    }
  }

  function setRoom(code) {
    state.room = code;
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
    history.replaceState(null, '', url);
    renderNet();
    reconnect();
  }

  function newRoomCode() {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
    return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => abc[b % abc.length]).join('');
  }

  el.createRoom.addEventListener('click', () => {
    const code = newRoomCode();
    setRoom(code);
    toast(t('room.joined', { code }));
  });
  el.joinRoom.addEventListener('click', () => {
    const input = prompt(t('room.joinPrompt'), '');
    if (input === null) return;
    const code = input.replace(/\s/g, '').toUpperCase();
    if (!ROOM_RE.test(code)) { toast(t('room.bad')); return; }
    setRoom(code);
    toast(t('room.joined', { code }));
  });
  el.copyRoom.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomLink());
      toast(t('room.copied'));
    } catch {
      prompt(t('room.copy'), roomLink());
    }
  });
  // QR code of the room link, made in the page: a phone camera opens the link and joins.
  // Always dark on white, whatever the theme, so every scanner reads it.
  function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const m = 4; // quiet zone
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="${esc(text)}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  el.qrRoom.addEventListener('click', () => {
    const link = roomLink();
    el.qrBox.innerHTML = qrSvg(link);
    el.qrCode.textContent = state.room;
    el.qrLink.textContent = link;
    el.qrDialog.showModal();
  });
  el.qrClose.addEventListener('click', () => el.qrDialog.close());
  // A tap outside the box closes it too.
  el.qrDialog.addEventListener('click', (e) => { if (e.target === el.qrDialog) el.qrDialog.close(); });

  el.leaveRoom.addEventListener('click', () => {
    setRoom('');
    toast(t('room.left'));
  });

  // ---------- language ----------
  el.langSelect.innerHTML = Object.entries(I18n.LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  el.langSelect.value = I18n.lang;
  el.langSelect.addEventListener('change', () => I18n.set(el.langSelect.value));
  I18n.onChange(() => {
    el.langSelect.value = I18n.lang;
    if (state.status) setStatus(state.status);
    renderMe();
    renderNet();
    renderPeers();
    renderPicked();
    renderLimit();
    Transfer.render();
  });

  window.App = {
    fmtSize, esc, toast, sendJSON, el,
    maxFile: () => state.maxFile, fmtMax,
    peerName: (id, fallback) => (state.peers.get(id) || {}).name || fallback || t('leftDevice'),
  };

  I18n.apply();
  renderNet();
  renderMe();
  renderPeers();
  renderPicked();
  Transfer._socket = () => state.ws;
  Direct.init({ myId: () => state.myId, signal: (to, data) => sendJSON({ type: 'signal', to, data }) });
  Transfer.init();
  connect();
})();
