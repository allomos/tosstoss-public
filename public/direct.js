'use strict';
// Direct links between two devices (WebRTC data channels), so a file can skip the server.
// The server only passes the few "signal" messages that set a link up. A link is opened when
// someone ticks a device or sends a file to it, never just because devices see each other.
// If it cannot open in time, the transfer goes through the server as before.
(function () {
  // STUN lets two devices on different networks find a way to each other. On one Wi-Fi it is
  // not needed: the devices reach each other directly.
  const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const RETRY_AFTER = 60000; // after a link failed, use the server for this device for a while

  /** @type {Map<string, {pc: RTCPeerConnection, dc: RTCDataChannel, opened: Promise<boolean>, makingOffer: boolean, pending: RTCIceCandidateInit[]}>} */
  const links = new Map();
  const failedAt = new Map(); // peerId -> time the last link to it failed

  let myId = () => null;
  let signal = () => false;
  const handlers = { message() {}, closed() {}, drain() {}, status() {} };

  // The device that starts the link makes the offer; the other one only answers.
  function create(peerId, starting) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    // Both sides create the same channel (id 0), so it does not matter who started the link.
    const dc = pc.createDataChannel('tosstoss', { negotiated: true, id: 0, ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 256 * 1024;
    const link = { pc, dc, makingOffer: false, pending: [], wasOpen: false, closing: false };
    link.opened = new Promise((resolve) => {
      dc.onopen = () => { link.wasOpen = true; resolve(true); handlers.status(peerId); };
      dc.onclose = () => { resolve(false); drop(peerId, link); };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { resolve(false); drop(peerId, link); }
      };
    });
    dc.onmessage = (e) => handlers.message(peerId, e.data);
    dc.onbufferedamountlow = () => handlers.drain();
    pc.onicecandidate = (e) => { if (e.candidate) signal(peerId, { candidate: e.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      if (!starting) return;
      try {
        link.makingOffer = true;
        await pc.setLocalDescription();
        signal(peerId, { description: pc.localDescription.toJSON() });
      } catch {
        drop(peerId, link);
      } finally {
        link.makingOffer = false;
      }
    };
    links.set(peerId, link);
    return link;
  }

  function drop(peerId, link) {
    if (links.get(peerId) !== link) return;
    links.delete(peerId);
    // A link that never opened failed; one that opened and ended later may be tried again at once.
    if (!link.wasOpen && !link.closing) failedAt.set(peerId, Date.now());
    try { link.pc.close(); } catch {}
    handlers.closed(peerId);
    handlers.status(peerId);
  }

  // Signals from the other device. When both start a link at once, the device with the
  // smaller ID gives way ("polite"), so exactly one offer wins.
  async function onSignal(from, data) {
    if (!data || typeof data !== 'object') return;
    let link = links.get(from);
    try {
      if (data.description) {
        const offer = data.description.type === 'offer';
        if (!link) {
          if (!offer) return;
          link = create(from, false);
        }
        const collision = offer && (link.makingOffer || link.pc.signalingState !== 'stable');
        if (collision && !(myId() < from)) return; // we are impolite: ignore theirs, ours wins
        await link.pc.setRemoteDescription(data.description); // a polite device rolls its own offer back
        for (const c of link.pending.splice(0)) await link.pc.addIceCandidate(c).catch(() => {});
        if (offer) {
          await link.pc.setLocalDescription();
          signal(from, { description: link.pc.localDescription.toJSON() });
        }
      } else if (data.candidate && link) {
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(data.candidate).catch(() => {});
        else link.pending.push(data.candidate);
      }
    } catch {
      if (link) drop(from, link);
    }
  }

  // An open channel to this device, opening one if needed; null when it does not open in time.
  // After a failed attempt the server is used for a while, unless `force` (a person asked).
  async function open(peerId, timeoutMs, force) {
    if (!window.RTCPeerConnection || Direct.disabled || !myId()) return null;
    const ready = links.get(peerId);
    if (ready && ready.dc.readyState === 'open') return ready.dc;
    if (!ready && !force && Date.now() - (failedAt.get(peerId) || 0) < RETRY_AFTER) return null;
    const link = ready || create(peerId, true);
    const ok = await Promise.race([link.opened, new Promise((r) => setTimeout(() => r(false), timeoutMs))]);
    if (ok && link.dc.readyState === 'open') return link.dc;
    drop(peerId, link);
    return null;
  }

  window.Direct = {
    disabled: false, // set true in the console to force every transfer through the server
    init(opts) {
      myId = opts.myId;
      signal = opts.signal;
    },
    onMessage(f) { handlers.message = f; },
    onClosed(f) { handlers.closed = f; },
    onDrain(f) { handlers.drain = f; }, // a channel's send buffer emptied: sending can go on
    onStatus(f) { handlers.status = f; }, // a link to this device opened or ended
    RETRY_AFTER,
    open,
    isOpen(peerId) {
      const link = links.get(peerId);
      return !!link && link.dc.readyState === 'open';
    },
    // Ends the link to this device because it is no longer wanted (not a failure).
    close(peerId) {
      const link = links.get(peerId);
      if (!link) return;
      link.closing = true;
      drop(peerId, link);
    },
    // A message to a device we have an open channel to.
    send(peerId, data) {
      const link = links.get(peerId);
      if (!link || link.dc.readyState !== 'open') return false;
      try { link.dc.send(data); return true; } catch { return false; }
    },
    // Bytes waiting in the channel's send buffer.
    buffered(peerId) {
      const link = links.get(peerId);
      return link ? link.dc.bufferedAmount : 0;
    },
    // Largest message the channel takes (64 KB unless the other browser allows less).
    maxMessage(peerId) {
      const link = links.get(peerId);
      const max = link && link.pc.sctp && link.pc.sctp.maxMessageSize;
      return Math.min(64 * 1024, max || 64 * 1024);
    },
    handleSignal(msg) { onSignal(msg.from, msg.data); },
    // Our server connection dropped: device IDs change when we come back, so every link ends.
    reset() {
      for (const [id, link] of [...links]) drop(id, link);
      failedAt.clear();
    },
  };
})();
