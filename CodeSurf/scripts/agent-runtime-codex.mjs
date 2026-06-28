#!/usr/bin/env node
// Generic CodeSurf Codex runtime adapter.
//
// Runs inside a terminal tile (or future hidden runtime process), registers an
// Agent through Contex's semantic agent_* API, polls its inbox, calls `codex exec`
// for each message, and replies through Contex.

import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SYSTEM_PROMPT = [
  'You are an autonomous Codex agent running inside a CodeSurf workflow.',
  'Use the Agent role, objective, and message context to help the team.',
  'If you need human permission, credentials, destructive approval, or a major product decision, reply with: HUMAN_ATTENTION: <short question for the human>.',
  'Reply clearly and keep the collaboration moving.',
].join('\n');

export function buildAgentConfig(env = process.env, cwd = process.cwd()) {
  const profile = parseProfile(env.AGENT_PROFILE_JSON);
  const agentId = env.AGENT_ID || env.AGENT_TILE_ID || env.CARD_ID || profile.agent_id || profile.tile_id;
  const tileId = env.AGENT_TILE_ID || env.CARD_ID || profile.tile_id || agentId;
  const role = env.AGENT_ROLE || profile.role || 'worker';
  const runtime = profile.runtime || env.AGENT_RUNTIME || 'codex';
  const model = env.AGENT_MODEL || profile.model || env.CODEX_CHAT_MODEL || '';
  const systemPrompt = env.AGENT_SYSTEM_PROMPT || profile.system_prompt || DEFAULT_SYSTEM_PROMPT;
  const agentCwd = env.AGENT_CWD || profile.cwd || cwd;
  const capabilities = Array.isArray(profile.capabilities)
    ? profile.capabilities
    : Array.isArray(profile.tools)
      ? profile.tools
      : ['chat', 'terminal_input'];
  return {
    contexUrl: env.CONTEX_URL || '',
    contexToken: env.CONTEX_TOKEN || '',
    workspaceId: env.CONTEX_WORKSPACE || profile.workspace_id || '',
    agentId,
    tileId,
    runtime,
    role,
    displayName: env.AGENT_DISPLAY_NAME || profile.display_name || profile.name || agentId,
    model,
    systemPrompt,
    cwd: agentCwd,
    capabilities,
    pollMs: Number(env.AGENT_POLL_MS || env.CODEX_CHAT_POLL_MS || 15000),
    maxReplyChars: Number(env.AGENT_MAX_REPLY_CHARS || env.CODEX_CHAT_MAX_REPLY_CHARS || 18000),
  };
}

export function buildCodexPrompt(config, message) {
  return [
    config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    '',
    `Agent role: ${config.role || 'worker'}`,
    `Agent id: ${config.agentId || config.tileId || 'unknown'}`,
    '',
    `Message from ${message.from_tile_id || 'unknown'}:`,
    String(message.text || ''),
  ].join('\n');
}

export class CodexAgentRuntime {
  constructor(config, { fetchImpl = globalThis.fetch, spawnImpl = spawn, log = defaultLog } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.spawn = spawnImpl;
    this.log = log;
    this.mcpUrl = normalizeMcpUrl(config.contexUrl);
    this.session = null;
    this.seq = 1;
    this.busy = false;
    this.pausedUntil = 0;
    this.rateLimitedUntil = 0;
  }

  async start() {
    validateConfig(this.config);
    this.log(`starting ${this.config.agentId} (${this.config.role}) in ${this.config.cwd}`);
    await this.register('idle', 'Waiting for messages');
    this.log(`registered ${this.config.agentId}; listening for Contex messages`);
    setInterval(() => this.poll().catch((err) => this.log(`poll error: ${err.message}`)), this.config.pollMs);
    await this.poll();
  }

  async post(message) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.config.contexToken}`,
    };
    if (this.session) headers['mcp-session-id'] = this.session;
    const res = await this.fetch(this.mcpUrl, { method: 'POST', headers, body: JSON.stringify(message) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.session = sid;
    const text = await res.text();
    if (!res.ok) {
      let retryAfter = Number(res.headers.get('retry-after') || 0);
      if (!retryAfter && text) {
        try { retryAfter = Number(JSON.parse(text).retryAfter || 0); } catch { retryAfter = 0; }
      }
      const error = new Error(`Contex HTTP ${res.status}: ${text}`);
      error.retryAfterMs = retryAfter > 0 ? retryAfter * 1000 : 0;
      throw error;
    }
    return text ? parseBody(text, res.headers.get('content-type')) : null;
  }

  async initialize() {
    if (this.session) return;
    await this.post({
      jsonrpc: '2.0',
      id: this.seq++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'codesurf-agent-runtime-codex', version: '0.1.0' },
      },
    });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async callTool(name, args = {}) {
    await this.initialize();
    const body = await this.post({
      jsonrpc: '2.0',
      id: this.seq++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const result = body?.result;
    if (result?.isError) {
      const e = result.structuredContent?.error;
      throw new Error(e?.message || e?.code || 'Contex tool error');
    }
    return result?.structuredContent ?? JSON.parse(result?.content?.[0]?.text || '{}');
  }

  async register(status = 'working', task = 'Codex runtime adapter') {
    return this.callTool('agent_register', {
      workspace_id: this.config.workspaceId || undefined,
      agent_id: this.config.agentId,
      tile_id: this.config.tileId,
      runtime: this.config.runtime,
      role: this.config.role,
      display_name: this.config.displayName,
      status,
      task,
      summary: `Codex runtime adapter (${this.config.role}).`,
      capabilities: this.config.capabilities,
    });
  }

  async updateState(status, task, summary = undefined) {
    return this.callTool('agent_update_state', {
      workspace_id: this.config.workspaceId || undefined,
      agent_id: this.config.agentId,
      status,
      task,
      ...(summary !== undefined ? { summary } : {}),
    });
  }

  async poll() {
    if (Date.now() < this.pausedUntil || this.busy) return;
    this.busy = true;
    try {
      const out = await this.callTool('agent_read_messages', {
        agent_id: this.config.agentId,
        unread_only: true,
        limit: 5,
      });
      for (const message of out.messages || []) await this.handleMessage(message);
    } catch (err) {
      if (err.retryAfterMs) {
        this.pausedUntil = Date.now() + err.retryAfterMs;
        if (this.pausedUntil > this.rateLimitedUntil) {
          this.rateLimitedUntil = this.pausedUntil;
          this.log(`rate limited by Contex; retrying after ${Math.ceil(err.retryAfterMs / 1000)}s`);
        }
      } else {
        this.log(`poll error: ${err.message}`);
      }
    } finally {
      this.busy = false;
    }
  }

  async handleMessage(message) {
    const text = String(message.text || '').trim();
    if (!text || message.from_tile_id === this.config.tileId || message.from_tile_id === this.config.agentId) return;
    this.log(`message from ${message.from_tile_id}: ${text.slice(0, 120)}`);
    await this.updateState('working', 'Thinking with codex exec');
    const reply = await this.runCodex(message);
    const humanRequest = parseHumanAttention(reply);
    if (humanRequest) {
      await this.callTool('agent_request_human_input', {
        agent_id: this.config.agentId,
        question: humanRequest.question,
        reason: humanRequest.reason,
        severity: humanRequest.severity,
      });
      if (message.from_tile_id) {
        await this.callTool('agent_report', {
          from_agent_id: this.config.agentId,
          to_agent_id: message.from_tile_id,
          text: `Waiting for human input: ${humanRequest.question}`,
        }).catch(() => {});
      }
      this.log(`waiting for human input: ${humanRequest.question}`);
      return;
    }
    await this.callTool('agent_send_message', {
      from_agent_id: this.config.agentId,
      to_agent_id: message.from_tile_id,
      text: reply,
    });
    await this.updateState('idle', 'Waiting for messages');
    this.log(`replied to ${message.from_tile_id}`);
  }

  runCodex(message) {
    return runCodexWithConfig(this.config, message, { spawnImpl: this.spawn });
  }
}

export function runCodexWithConfig(config, message, { spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const outputFile = join(tmpdir(), `codesurf-agent-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    const args = [
      'exec',
      '--cd', config.cwd,
      '--sandbox', 'workspace-write',
      '--output-last-message', outputFile,
      ...(config.model ? ['--model', config.model] : []),
      buildCodexPrompt(config, message),
    ];
    const child = spawnImpl('codex', args, {
      cwd: config.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => { out += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { err += chunk.toString('utf8'); });
    child.on('error', (error) => resolve(`Codex failed to start: ${error.message}`));
    child.on('exit', async (code) => {
      try {
        const lastMessage = (await readFile(outputFile, 'utf8')).trim();
        if (lastMessage) {
          resolve(lastMessage.slice(-config.maxReplyChars));
          return;
        }
      } catch {
        // The file is only created after Codex reaches a final answer.
      } finally {
        await unlink(outputFile).catch(() => {});
      }
      const fallback = code === 0
        ? out.trim()
        : [err.trim(), out.trim()].filter(Boolean).join('\n');
      const text = fallback || `(codex exited with code ${code ?? 'unknown'} and no output)`;
      resolve(text.slice(-config.maxReplyChars));
    });
  });
}

export function parseHumanAttention(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^HUMAN_ATTENTION(?:\[(permission|decision|credential|destructive|blocked)\])?\s*:\s*([\s\S]+)$/i);
  if (!match) return null;
  const severity = (match[1] || 'decision').toLowerCase();
  const question = match[2].trim();
  if (!question) return null;
  return { severity, question, reason: severity };
}

export async function main({ env = process.env, cwd = process.cwd(), fetchImpl = globalThis.fetch, spawnImpl = spawn, log = defaultLog } = {}) {
  const config = buildAgentConfig(env, cwd);
  const runtime = new CodexAgentRuntime(config, { fetchImpl, spawnImpl, log });
  await runtime.start();
}

function parseProfile(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function normalizeMcpUrl(url) {
  const trimmed = String(url || '').replace(/\/+$/, '');
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`;
}

function parseBody(text, contentType = '') {
  if (contentType.includes('text/event-stream')) {
    const data = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).pop();
    return data ? JSON.parse(data) : null;
  }
  return JSON.parse(text);
}

function validateConfig(config) {
  if (!config.contexUrl || !config.contexToken || !config.agentId || !config.tileId) {
    throw new Error('Missing CONTEX_URL, CONTEX_TOKEN, and AGENT_ID/AGENT_TILE_ID/CARD_ID. Start CodeSurf with --contex.');
  }
}

function defaultLog(line) {
  process.stdout.write(`[codex-agent] ${line}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(`[codex-agent] ${err.message}`);
    process.exit(1);
  });
}
