// util/env.mjs — a tiny .env loader (no dependency).
//
// Tutorial note:
//   Node does NOT read .env automatically. The parent project loads it by hand
//   (tools/ai-bots.mjs does the same). This parses simple KEY=VALUE lines and
//   populates process.env without overwriting anything already set, so real
//   environment variables always win over the file.

import { readFileSync, existsSync } from 'node:fs';

/**
 * Load KEY=VALUE pairs from a .env file into process.env.
 * Returns the parsed pairs. Missing file → {} (not an error).
 */
export function loadEnv(path) {
  const parsed = {};
  if (!existsSync(path)) return parsed;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // strip matching surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return parsed;
}
