---
writer: claude/tosstoss-goal
tasks: A01-01, A01-03
written: 2026-10-17T15:04Z
updated: 2026-10-17T15:14Z
---

# Handoff — claude/tosstoss-goal

Run mode: quiet (chosen by the person when starting the goal in Allomos, 2026-10-17).

## State (2026-10-18)
- Goal A01-01 (投桃 Tosstoss) is **waiting on the person**: try the app (steps in A01-03), ideally on a real phone. All other tasks done (finished without the human check, quiet mode; steps on each).
- Releases on main: tags `v0.1`, `v0.2`. `npm test`: 8 pass (presence, relay, acks/failures, 200MB to two receivers).
- Code: server.js (static files, WebSocket presence, file relay keeping each transfer until every receiver acks the last byte); public/app.js (connection, peers, picking, offline), public/transfer.js (send queue, 8MB ack window, auto-receive + 保存), public/names.js (fruit names, rename).

## If the person reports problems
- Add a task in a new iteration (v0.3) per problem, plan, ready, then build.
- Ideas not in the spec (not planned): direct WebRTC transfer, QR code for the URL, keep-awake (needs https).

## Nothing running
Preview server stopped. No Git remote: commit only.
