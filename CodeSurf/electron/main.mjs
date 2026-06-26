// CodeSurf Electron shell.
//
// Electron is the desktop host for the same loopback server + DOM/SVG canvas the
// web mode serves — so the entire tested REST/SSE API and frontend are reused
// unchanged. What Electron adds: it runs in a Node main process that can load the
// native `node-pty`, so terminal tiles get a REAL PTY (interactive claude/codex),
// and a real application window instead of a browser tab.
//
// Run:  npm install   (pulls electron + builds/fetches node-pty)
//       npm run app    [-- --contex]
//
// Requires Electron >= 28 (ESM main support).

import { app, BrowserWindow } from 'electron';
import { openCodeSurf } from '../src/index.mjs';
import { startServer } from '../src/server.mjs';
import { TerminalManager, ptyAvailable } from '../src/terminal.mjs';
import { ContexSupervisor } from '../src/contex.mjs';
import { ContexConnection } from '../src/contex-connection.mjs';

let contex = null;
let terminals = null;
let httpServer = null;

async function boot() {
  const { store } = openCodeSurf();

  if (process.argv.includes('--contex')) {
    const supervisor = new ContexSupervisor({});
    supervisor.on('error', (e) => console.error('Contex supervisor:', e.message));
    contex = new ContexConnection({ supervisor });
    contex.start().catch((e) => console.error('Contex failed to start:', e.message));
  }

  // real PTY in Electron (node-pty lives in the main process)
  terminals = new TerminalManager({ contex, pty: ptyAvailable() });
  const { server, url } = await startServer({ store, contex, terminals, port: 0 });
  httpServer = server;
  console.log(`CodeSurf serving ${url} (terminals: ${ptyAvailable() ? 'real PTY' : 'piped'})`);
  return url;
}

app.whenReady().then(async () => {
  const url = await boot();
  const win = new BrowserWindow({
    width: 1280, height: 860, backgroundColor: '#0f1115',
    title: 'CodeSurf',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win.loadURL(url);
  });
});

function shutdown() {
  try { terminals?.stopAll(); } catch { /* ignore */ }
  try { contex?.stop?.(); } catch { /* ignore */ }
  try { httpServer?.close(); } catch { /* ignore */ }
}

app.on('window-all-closed', () => { shutdown(); app.quit(); });
app.on('before-quit', shutdown);
