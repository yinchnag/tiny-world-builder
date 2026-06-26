// Opt-in real-PTY check (needs the optional native dep node-pty). Verifies a
// terminal started with the PTY backend gives the child a genuine TTY. Kept out
// of `npm test` because node-pty leaves a lingering handle and is optional.
//
//     npm install --save-optional node-pty
//     node scripts/pty-check.mjs
//
// Exits 0 on success (or a clean skip if node-pty isn't installed), 1 on failure.

import { once } from 'node:events';
import { Terminal, ptyAvailable } from '../src/terminal.mjs';

if (!ptyAvailable()) {
  console.log('node-pty not installed — skipping PTY check (terminals will use piped stdio).');
  process.exit(0);
}

const t = new Terminal('tile_pty_check', { pty: true });
let out = '';
t.on('data', (d) => { out += d; });
t.start({ command: process.execPath, args: ['-e', 'process.stdout.write("isTTY=" + process.stdout.isTTY)'] });
await once(t, 'exit');

const ok = t.backend === 'pty' && /isTTY=true/.test(out);
console.log(`backend=${t.backend}  childSawTTY=${/isTTY=true/.test(out)}`);
console.log(ok ? 'ok  real PTY gives the child a TTY' : 'FAIL  PTY check');
process.exit(ok ? 0 : 1); // explicit exit — node-pty keeps the loop alive otherwise
