import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { McpClient, McpAuthError, McpCallError } from '../src/mcp-client.mjs';
import { startMockMcp } from './helpers/mock-mcp.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('connect performs the handshake and reports serverInfo', async () => {
  const mock = await startMockMcp({ token: 'tok-a' });
  const client = new McpClient({ url: mock.url, token: 'tok-a' });
  const info = await client.connect();
  assert.equal(info.name, 'mock-contex');
  assert.ok(client.session);
  await client.close();
  await mock.close();
});

test('tools/call returns structuredContent', async () => {
  const mock = await startMockMcp({ token: 'tok-a', tools: {
    peer_set_state: (args) => ({ tile_id: args.tile_id, status: args.status, version: 1 }),
  } });
  const client = new McpClient({ url: mock.url, token: 'tok-a' });
  await client.connect();
  const out = await client.call('peer_set_state', { tile_id: 't1', status: 'working' });
  assert.equal(out.status, 'working');
  assert.equal(out.version, 1);
  await client.close();
  await mock.close();
});

test('a business error surfaces as McpCallError with code', async () => {
  const mock = await startMockMcp({ tools: {
    update_task: () => { const e = new Error('Illegal transition'); e.code = 'CONTEXT_INVALID_TRANSITION'; throw e; },
  } });
  const client = new McpClient({ url: mock.url, token: 'tok-a' });
  await client.connect();
  await assert.rejects(() => client.call('update_task', {}), (e) =>
    e instanceof McpCallError && e.code === 'CONTEXT_INVALID_TRANSITION');
  await client.close();
  await mock.close();
});

test('SSE notifications are delivered to listeners', async () => {
  const mock = await startMockMcp();
  const client = new McpClient({ url: mock.url, token: 'tok-a' });
  await client.connect();
  await wait(50); // let the GET stream attach
  const got = once(client, 'notification');
  mock.push({ method: 'notifications/context/tile_state_changed', params: { tile_id: 't1', status: 'working' } });
  const [payload] = await got;
  assert.equal(payload.params.tile_id, 't1');
  await client.close();
  await mock.close();
});

test('duplicate SSE events (same id) are delivered once', async () => {
  const mock = await startMockMcp();
  const client = new McpClient({ url: mock.url, token: 'tok-a' });
  await client.connect();
  await wait(50);
  let count = 0;
  client.on('notification', () => count++);
  mock.push({ method: 'x', params: { n: 1 } }, 'evt-1');
  mock.push({ method: 'x', params: { n: 1 } }, 'evt-1'); // same id → dropped
  mock.push({ method: 'x', params: { n: 2 } }, 'evt-2');
  await wait(80);
  assert.equal(count, 2);
  await client.close();
  await mock.close();
});

test('token rotation makes calls fail with McpAuthError', async () => {
  const mock = await startMockMcp({ token: 'tok-a' });
  const client = new McpClient({ url: mock.url, token: 'tok-a' });
  await client.connect();
  mock.setToken('tok-b'); // server rotated its token (e.g. after a restart)
  await assert.rejects(() => client.call('peer_get_state', { tile_id: 't1' }), McpAuthError);
  // a fresh client with the new token works again
  const client2 = new McpClient({ url: mock.url, token: 'tok-b' });
  await client2.connect();
  assert.ok(client2.connected);
  await client2.close();
  await client.close();
  await mock.close();
});

test('the stream reconnects after the server drops it', async () => {
  const mock = await startMockMcp();
  const client = new McpClient({ url: mock.url, token: 'tok-a' });
  await client.connect();
  await wait(50);
  mock.dropStreams();          // kill the open SSE stream
  await wait(400);             // client should reconnect (backoff starts at 200ms)
  const got = once(client, 'notification');
  mock.push({ method: 'after-reconnect', params: { ok: true } });
  const [payload] = await got;
  assert.equal(payload.method, 'after-reconnect');
  await client.close();
  await mock.close();
});
