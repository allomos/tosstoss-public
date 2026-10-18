#!/usr/bin/env node
// Runs wrangler for the `unlimited` env with its real Worker name, which never goes into Git.
//   node scripts/unlimited.js deploy   → publish (needs the real name)
//   node scripts/unlimited.js dev      → local dev server (the real name is optional)
//   node scripts/unlimited.js new-name → print a fresh hard-to-guess name for .unlimited-name
// The real name comes from TOSSTOSS_UNLIMITED_NAME, or else from the file .unlimited-name
// (git-ignored). wrangler.jsonc holds only the placeholder below.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PLACEHOLDER = '__UNLIMITED_WORKER_NAME__';
const NAME_FILE = path.join(ROOT, '.unlimited-name');
// Beside wrangler.jsonc, so the paths inside it resolve the same way; git-ignored.
const TEMP_CONFIG = path.join(ROOT, 'wrangler.unlimited.local.jsonc');

function newName() {
  // "tosstoss-" + 48 random lowercase letters and digits: 57 characters, under the 63 allowed.
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (const b of crypto.randomBytes(48)) s += chars[b % chars.length];
  return `tosstoss-${s}`;
}

function realName() {
  let name = process.env.TOSSTOSS_UNLIMITED_NAME;
  if (!name && fs.existsSync(NAME_FILE)) name = fs.readFileSync(NAME_FILE, 'utf8');
  name = (name || '').trim();
  if (name && !/^[a-z0-9-]{1,63}$/.test(name)) {
    console.error('The unlimited Worker name must be 1–63 lowercase letters, digits or dashes.');
    process.exit(1);
  }
  return name;
}

const cmd = process.argv[2];
if (cmd === 'new-name') {
  console.log(newName());
  process.exit(0);
}
if (cmd !== 'deploy' && cmd !== 'dev') {
  console.error('Usage: node scripts/unlimited.js deploy|dev|new-name');
  process.exit(1);
}

let name = realName();
if (!name) {
  if (cmd === 'deploy') {
    console.error(
      'No real name for the unlimited Worker. Put it in .unlimited-name (one line) or set\n' +
        'TOSSTOSS_UNLIMITED_NAME. A new one: node scripts/unlimited.js new-name > .unlimited-name'
    );
    process.exit(1);
  }
  name = 'tosstoss-unlimited-dev'; // local only, never published
}

const config = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
if (!config.includes(`"${PLACEHOLDER}"`)) {
  console.error(`wrangler.jsonc no longer has the placeholder "${PLACEHOLDER}".`);
  process.exit(1);
}
fs.writeFileSync(TEMP_CONFIG, config.replace(`"${PLACEHOLDER}"`, JSON.stringify(name)));
let status = 1;
try {
  const args = [cmd, '--config', TEMP_CONFIG, '--env', 'unlimited', ...process.argv.slice(3)];
  const r = spawnSync('npx', ['wrangler', ...args], { cwd: ROOT, stdio: 'inherit' });
  status = r.status ?? 1;
} finally {
  fs.rmSync(TEMP_CONFIG, { force: true });
}
process.exit(status);
