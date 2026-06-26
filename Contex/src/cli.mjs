#!/usr/bin/env node
// -------- contex CLI --------
// `contex serve` boots the coordination service: opens (or creates) the SQLite
// db, ensures a default workspace, mints an in-memory bearer token, and listens
// on loopback. The launcher reads the JSON line on stderr to learn the url+token.
//
//   node --experimental-sqlite src/cli.mjs serve [options]
//     --db <path>        SQLite file (default: ./contex.db; ':memory:' for ephemeral)
//     --port <n>         port (default: 0 = pick a free port)
//     --host <addr>      bind host (default: 127.0.0.1, loopback only)
//     --workspace <name> default workspace name (default: basename of --repo or 'workspace')
//     --repo <path>      repository path attached to the workspace
//     --token <tok>      bearer token (default: generated; or env CONTEX_TOKEN)

import { basename, resolve } from 'node:path';
import { createContex } from './index.mjs';
import { createToken } from './auth.mjs';
import { startServer } from './server.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else out._.push(a);
  }
  return out;
}

async function serve(args) {
  const dbPath = args.db ? String(args.db) : resolve(process.cwd(), 'contex.db');
  const repo = args.repo ? resolve(String(args.repo)) : null;
  const wsName = args.workspace ? String(args.workspace) : repo ? basename(repo) : 'workspace';
  const token = args.token ? String(args.token) : process.env.CONTEX_TOKEN || createToken();

  const contex = createContex({ dbPath });
  let ws = contex.soleWorkspace();
  if (!ws) ws = contex.createWorkspace({ name: wsName, repository_path: repo });

  const { url, port, close } = await startServer({
    contex,
    token,
    port: args.port ? Number(args.port) : 0,
    host: args.host ? String(args.host) : '127.0.0.1',
  });

  // launcher handshake: machine-readable on stderr, NEVER committed anywhere
  process.stderr.write(JSON.stringify({ event: 'listening', url, port, workspace_id: ws.id, token }) + '\n');
  process.stdout.write(`contex serving ${url} (db: ${dbPath}, workspace: ${ws.id})\n`);

  const shutdown = async () => {
    await close();
    contex.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || 'serve';
if (cmd === 'serve') {
  serve(args).catch((e) => {
    process.stderr.write(`contex: ${e.message}\n`);
    process.exit(1);
  });
} else {
  process.stderr.write(`contex: unknown command '${cmd}'. Try: contex serve\n`);
  process.exit(1);
}
