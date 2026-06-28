#!/usr/bin/env node
// Compatibility entry point for the original CodeSurf Codex chat bridge.
// The implementation now lives in agent-runtime-codex.mjs, which supports
// Agent profiles, roles, models, and Contex's agent_* semantic tools.

import { main } from './agent-runtime-codex.mjs';

await main();

