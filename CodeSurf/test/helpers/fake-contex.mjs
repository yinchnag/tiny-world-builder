// A stand-in for `contex serve` used by supervisor tests — prints a listening
// handshake (with a fresh random token each launch, so a restart looks like a
// real token rotation) and then stays alive, or exits after a delay to exercise
// the restart path. No SQLite, no real server.

import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const exitAfter = num(flag('--exit-after'));

const handshake = {
  event: 'listening',
  url: 'http://127.0.0.1:0/mcp',
  port: 0,
  workspace_id: 'ws_fake',
  token: randomUUID().replace(/-/g, ''),
};
process.stderr.write(JSON.stringify(handshake) + '\n');

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

if (exitAfter != null) {
  setTimeout(() => process.exit(1), exitAfter);
} else {
  setInterval(() => {}, 1 << 30); // stay alive until killed
}

function flag(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
function num(v) { return v == null ? null : Number(v); }
