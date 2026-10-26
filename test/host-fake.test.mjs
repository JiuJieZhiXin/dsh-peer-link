import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

const quiet = { info() {}, warn() {}, error() {} };

function fakeContext(services) {
  const disposers = [];
  const ctx = {
    logger: quiet,
    get(name) {
      return services[name];
    },
    effect(fn) {
      const disposer = fn();
      disposers.push(disposer);
      return disposer;
    },
    inject(names, callback) {
      const child = {
        ...ctx,
        effect(fn) {
          const disposer = fn();
          disposers.push(disposer);
          return disposer;
        },
      };
      for (const name of names) child[name] = services[name];
      callback(child);
    },
  };
  return { ctx, disposers };
}

async function waitFor(check, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out');
}

const ALLOWED_SCHEMA_KEYS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'description', 'title', 'default', 'examples',
]);
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function assertSchemaSubset(node, path) {
  assert.ok(node && typeof node === 'object' && !Array.isArray(node), `${path} must be a schema object`);
  for (const key of Object.keys(node)) {
    assert.ok(ALLOWED_SCHEMA_KEYS.has(key), `${path}.${key} is outside the enforced JSON Schema subset`);
  }
  if (node.type) assert.ok(SCHEMA_TYPES.has(node.type), `${path}.type is invalid`);
  if (node.properties) {
    for (const [key, child] of Object.entries(node.properties)) assertSchemaSubset(child, `${path}.properties.${key}`);
  }
  if (node.items) assertSchemaSubset(node.items, `${path}.items`);
  if (node.oneOf) node.oneOf.forEach((child, index) => assertSchemaSubset(child, `${path}.oneOf[${index}]`));
}

test('host glue starts, serves authenticated state, and registers tools', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-link-host-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  const toolDefs = [];
  const tools = {
    register(definition) {
      toolDefs.push(definition);
      return () => {};
    },
  };
  let route = null;
  let transform = null;
  const webServer = {
    tapIndex(fn) {
      transform = fn;
      return () => { transform = null; };
    },
    register(candidate) {
      route = candidate;
      return () => { route = null; };
    },
  };
  const { ctx, disposers } = fakeContext({ tools, webServer });
  apply(ctx, { name: 'Host test' });

  await waitFor(async () => {
    try {
      const files = await fs.readdir(path.join(home, 'peer-link', 'instances'));
      return files.filter((file) => file.endsWith('.json')).length === 1;
    } catch {
      return false;
    }
  });
  assert.equal(toolDefs.length, 3);
  for (const tool of toolDefs) {
    assert.equal(tool.parameters?.type, 'object', `${tool.name} parameters must be an object schema`);
    assert.equal(typeof tool.parameters.properties, 'object', `${tool.name} needs properties`);
    if (tool.parameters.required) assert.ok(Array.isArray(tool.parameters.required));
    assertSchemaSubset(tool.parameters, `${tool.name}.parameters`);
    assertSchemaSubset(tool.output.schema, `${tool.name}.output.schema`);
  }
  assert.ok(route);

  const registryFile = path.join(home, 'peer-link', 'instances', (await fs.readdir(path.join(home, 'peer-link', 'instances'))).find((file) => file.endsWith('.json')));
  const registry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  const html = transform('<html><head></head><body></body></html>');
  const tokenMatch = html.match(/token":"([a-f0-9]+)"/);
  assert.ok(tokenMatch);

  const server = http.createServer((req, res) => route.handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const loopbackNoToken = await fetch(`http://127.0.0.1:${port}/_peer-link/v1/state`);
  assert.equal(loopbackNoToken.status, 200);

  const crossOrigin = await fetch(`http://127.0.0.1:${port}/_peer-link/v1/state`, {
    headers: { origin: 'http://evil.example' },
  });
  assert.equal(crossOrigin.status, 401);

  const stateResponse = await fetch(`http://127.0.0.1:${port}/_peer-link/v1/state`, {
    headers: { 'x-peer-link-token': tokenMatch[1] },
  });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.ready, true);
  assert.equal(state.self.instanceId, registry.instanceId);
  assert.equal(state.self.port, registry.port);
  assert.equal(state.self.keyFingerprint, registry.keyFingerprint);

  const configResponse = await fetch(`http://127.0.0.1:${port}/_peer-link/v1/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.deepEqual(config.value.transports, ['local']);
  assert.equal(config.secrets.length, 2);

  const saveResponse = await fetch(`http://127.0.0.1:${port}/_peer-link/v1/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ maxMessages: 120 }),
  });
  assert.equal(saveResponse.status, 200);
  const savedConfig = await saveResponse.json();
  assert.equal(savedConfig.value.maxMessages, 120);
  const stored = JSON.parse(await fs.readFile(path.join(home, 'peer-link', 'state', process.env.DSH_PROFILE || 'desktop', 'settings.json'), 'utf8'));
  assert.equal(stored.maxMessages, 120);
  const reloaded = await fetch(`http://127.0.0.1:${port}/_peer-link/v1/config`);
  assert.equal((await reloaded.json()).value.maxMessages, 120);

  for (const enabled of [true, false]) {
    const toggle = await fetch(`http://127.0.0.1:${port}/_peer-link/v1/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoReply: enabled }),
    });
    assert.equal(toggle.status, 200);
    const stateAfter = await (await fetch(`http://127.0.0.1:${port}/_peer-link/v1/state`)).json();
    assert.equal(stateAfter.self.autoReply, enabled);
  }

  const list = await toolDefs.find((tool) => tool.name === 'peer_link_list').execute({}, {});
  assert.equal(list.ok, true);
  assert.ok(Array.isArray(list.peers));

  const inbox = await toolDefs.find((tool) => tool.name === 'peer_link_inbox').execute({}, {});
  assert.equal(inbox.ok, true);
  assert.deepEqual(inbox.messages, []);

  for (const dispose of disposers.reverse()) {
    try {
      await dispose?.();
    } catch {
      // best effort
    }
  }
  // The Host effect owns an async stop; give its final atomic store write a
  // moment before removing the temp home.
  await new Promise((resolve) => setTimeout(resolve, 400));
  await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
