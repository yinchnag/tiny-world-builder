// cli-status.mjs — `npm run status [registryPath]` (Phase 5).
//
// Prints the operability view for a registry file. Defaults to the waves demo's
// output so you can run `npm run demo:waves` then `npm run status` to see it.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { loadRegistry } from './registry/store.mjs';
import { formatStatus } from './status.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] ?? join(here, '..', '.run', 'waves-registry.json');

if (!existsSync(path)) {
  console.error(`No registry at ${path}. Pass a path, or run a demo first (e.g. npm run demo:waves).`);
  process.exitCode = 1;
} else {
  console.log(formatStatus(loadRegistry(path)));
}
