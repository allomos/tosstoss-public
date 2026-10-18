# Project notes

What every session must know, whatever its task. Keep it short, and change lines in place.

## Running

- Two Cloudflare deployments of the same code (the person's decision, 2026-10-18), account <CLOUDFLARE_ACCOUNT_EMAIL> (the one `npx wrangler whoami` shows on this Mac; never write the real address here), config in wrangler.jsonc:
  - `tosstoss` → https://tosstoss.mypals.workers.dev — files relayed by the server at most 20 MB each (MAX_FILE_BYTES, enforced by the server); direct (WebRTC) transfers have no limit (the person's decision, 2026-10-18). Public; meant to be shared. Deploy: `npm run deploy`.
  - env `unlimited` → https://<real name>.mypals.workers.dev — no size limit. Private: kept safe only by its hard-to-guess name; do not share it. The real name is never in Git: it lives in `.unlimited-name` (git-ignored, on this Mac) or TOSSTOSS_UNLIMITED_NAME; wrangler.jsonc holds the placeholder `__UNLIMITED_WORKER_NAME__`. Deploy: `npm run deploy:unlimited` (scripts/unlimited.js). Renamed 2026-10-18 before open-sourcing; the old Worker (its name is still in Git history) was deleted from Cloudflare the same day.
  - Deploy both after every change. Both share the account's free daily quota.
  - The unlimited name is 57 characters (`node scripts/unlimited.js new-name`): over Cloudflare's 54 for preview URLs, so that env sets `preview_urls: false`.
- Nothing runs locally. To try the app: `npm install && npm start` (port 8080, prints the LAN URL); the preview config is `.claude/launch.json` ("tosstoss"). Restart the server after changing server.js.

## Pitfalls

- Git remote `origin`: private GitHub repo mypals-ml/tosstoss (moved from willwhui on 2026-10-18; the person plans to open-source it, so never commit the unlimited name). Push after committing.
- Background/preview tabs get no requestAnimationFrame; the page renders with timers.
- Testing in one browser: use different origins (localhost, 127.0.0.1, the LAN IP) so each tab gets its own name in localStorage.
- `crypto.randomUUID` and Wake Lock need https; LAN pages are plain http.
- Two servers share one page protocol: server.js (LAN) and worker/index.js (Cloudflare). A protocol change goes into both; run `npm test`, then `npm run test:cf` against `npm run dev:cf` (20 MB) and against `npm run dev:cf:unlimited`.
- Node treats worker/index.js as CommonJS; check its syntax with `node --input-type=module --check < worker/index.js`.

## Where credentials live

Never their values. Cloudflare: wrangler's OAuth login on this Mac (`npx wrangler whoami`); nothing in the repo.

## Agents set up

AI agents whose rule files follow AGENTS.md (`alm guide agent-files`): agent, its file, date.
- Claude Code: CLAUDE.md (imports AGENTS.md), 2026-10-17
