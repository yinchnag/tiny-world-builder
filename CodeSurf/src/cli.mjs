#!/usr/bin/env node
// CodeSurf CLI. M1 surface: inspect and create workspaces. The `serve` command
// (loopback HTTP shell + DOM/SVG canvas) lands in M2.

import { openCodeSurf, defaultDataDir } from './index.mjs';
import { startServer } from './server.mjs';
import { ContexSupervisor } from './contex.mjs';
import { ContexConnection } from './contex-connection.mjs';
import { TerminalManager, ptyAvailable } from './terminal.mjs';

const CONTEX_CLI = new URL('../../Contex/src/cli.mjs', import.meta.url).pathname;

const [, , cmd, ...rest] = process.argv;

function fail(msg) {
  process.stderr.write(`codesurf: ${msg}\n`);
  process.exit(1);
}

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

const { store } = openCodeSurf();

switch (cmd) {
  case 'list': {
    const all = store.listWorkspaces({ includeArchived: rest.includes('--all') });
    if (all.length === 0) {
      process.stdout.write(`No workspaces yet (data dir: ${defaultDataDir()}).\n`);
      break;
    }
    for (const w of all) {
      process.stdout.write(`${w.id}  ${w.name}${w.archived ? ' [archived]' : ''}\n    ${w.repositoryPath}\n`);
    }
    break;
  }
  case 'create': {
    const name = flag('name');
    const repo = flag('repo');
    if (!name || !repo) fail('usage: codesurf create --name <name> --repo <repository-path>');
    try {
      const meta = store.createWorkspace({ name, repositoryPath: repo });
      process.stdout.write(`Created ${meta.id} (${meta.name}) → ${meta.repositoryPath}\n`);
    } catch (e) {
      fail(`${e.code || 'ERROR'}: ${e.message}`);
    }
    break;
  }
  case 'serve': {
    const port = Number(flag('port') ?? 0) || 0;
    let contex = null;
    if (rest.includes('--contex')) {
      const contexRateLimit = flag('contex-rate-limit') ?? '0';
      const supervisor = new ContexSupervisor({
        // Embedded Contex is a token-protected loopback service; CodeSurf's own
        // command drain plus chat/agent polling can exceed Contex's standalone
        // default of 60 req/min, so disable it unless explicitly overridden.
        args: ['--experimental-sqlite', CONTEX_CLI, 'serve', '--rate-limit', contexRateLimit],
      });
      supervisor.on('error', (e) => process.stderr.write(`Contex supervisor error: ${e.message}\n`));
      contex = new ContexConnection({ supervisor });
      contex.on('status', (s) => process.stderr.write(`Contex: ${s}\n`));
      contex.start()
        .then(({ url: cu }) => process.stderr.write(`Contex connected at ${cu}\n`))
        .catch((e) => process.stderr.write(`Contex failed to start: ${e.message}\n`));
    }
    const usePty = rest.includes('--pty') && ptyAvailable(); // real PTY (needs node-pty + an ANSI renderer to look right)
    const terminals = new TerminalManager({ contex, pty: usePty }); // contex may be null; env injection no-ops then
    const { url } = await startServer({ store, contex, terminals, port });
    process.stderr.write(`CodeSurf canvas serving at ${url}\n`);
    process.stderr.write(`Terminals: ${usePty ? 'real PTY (node-pty)' : 'piped stdio' + (rest.includes('--pty') ? ' (node-pty not installed)' : '')}\n`);
    process.stderr.write(`Data dir: ${defaultDataDir()}\n`);
    if (!contex) process.stderr.write(`(Contex off — pass --contex to launch the coordination backend)\n`);
    // keep the process alive; Ctrl-C to stop
    break;
  }
  default:
    process.stdout.write('codesurf <command>\n\n  list [--all]                     list known workspaces\n  create --name <n> --repo <path>  create a workspace bound to a repo\n  serve                            (M2) launch the canvas shell\n');
}
