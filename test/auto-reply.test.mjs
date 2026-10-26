import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';
import { PeerLinkNode } from '../lib/node.js';
import { deriveKey } from '../lib/protocol.js';

const quiet = { info() {}, warn() {}, error() {} };

function fakeContext(services) {
  const disposers = [];
  const ctx = {
    logger: quiet,
    get(name) { return services[name]; },
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

test('auto-reply injects an inbound peer message into the live agent', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-link-auto-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const followups = [];
  const agent = {
    id: 'session-auto-test',
    followup(message) { followups.push(message); },
  };
  const otherFollowups = [];
  const otherAgent = {
    id: 'session-other',
    followup(message) { otherFollowups.push(message); },
  };
  let sendTool;
  const services = {
    agents: {
      roots: () => [otherAgent, agent],
      get: (id) => (id === agent.id ? agent : id === otherAgent.id ? otherAgent : undefined),
    },
    tools: {
      register(definition) {
        if (definition.name === 'peer_link_send') sendTool = definition;
        return () => {};
      },
    },
    webServer: { tapIndex: () => () => {}, register: () => () => {} },
  };
  const { ctx, disposers } = fakeContext(services);
  apply(ctx, {
    name: 'Auto host',
    transports: ['local'],
    autoReply: true,
    autoReplySession: agent.id,
  });

  await waitFor(async () => {
    try {
      const files = await fs.readdir(path.join(home, 'peer-link', 'instances'));
      return files.length === 1;
    } catch {
      return false;
    }
  });
  const registryFile = path.join(home, 'peer-link', 'instances', (await fs.readdir(path.join(home, 'peer-link', 'instances')))[0]);
  const registry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  const secret = Buffer.from((await fs.readFile(path.join(home, 'peer-link', 'secret.key'), 'utf8')).trim(), 'base64');
  const key = deriveKey(secret);

  const fakeDir = path.join(home, 'fake');
  const peer = new PeerLinkNode({
    stateDir: fakeDir,
    key,
    name: 'Auto test peer',
    profileName: 'test',
    account: { signedIn: true, scope: registry.accountScope, label: 'Auto test' },
    config: {
      transports: ['local'],
      local: false,
      lan: false,
      manual: true,
      relay: false,
      relayUrl: '',
      relayToken: '',
      listenHost: '127.0.0.1',
      listenPort: 0,
      udpPort: 0,
      manualPeers: [],
      requireSameAccount: true,
      maxMessages: 50,
    },
    logger: quiet,
  });
  t.after(async () => {
    await peer.stop().catch(() => {});
    for (const dispose of disposers.reverse()) {
      try {
        await dispose?.();
      } catch {
        // best effort
      }
    }
  });
  await peer.start();
  peer.considerPeer({
    id: registry.instanceId,
    name: registry.name,
    accountScope: registry.accountScope,
    signedIn: true,
    endpoint: { host: '127.0.0.1', port: registry.port },
    source: 'manual',
  });
  await waitFor(() => peer.getState().peers.some((item) => item.id === registry.instanceId && item.online));
  await peer.send(registry.instanceId, 'please handle this automatically');

  await waitFor(() => followups.length === 1);
  assert.equal(otherFollowups.length, 0);
  const content = followups[0].content.map((block) => block.text).join('\n');
  assert.match(content, /Peer Link 自动接管/);
  assert.match(content, /please handle this automatically/);
  assert.match(content, new RegExp(peer.instanceId));
  assert.equal(followups[0].source.kind, 'user');
  // DSH commits the inbox message as a user/message surface event, which
  // requires a non-empty id and role "user"; otherwise the session becomes
  // unloadable and later model requests fail with "missing field role".
  assert.equal(followups[0].role, 'user');
  assert.equal(typeof followups[0].id, 'string');
  assert.match(followups[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(Array.isArray(followups[0].content));
  const wireMessage = JSON.parse(JSON.stringify(followups[0]));
  assert.equal(wireMessage.role, 'user');
  assert.equal(typeof wireMessage.id, 'string');
  assert.equal(wireMessage.content[0]?.type, 'text');
  assert.equal(typeof wireMessage.content[0]?.text, 'string');
  assert.equal(wireMessage.source?.kind, 'user');

  const toolResult = await sendTool.execute(
    { peer: peer.instanceId, text: 'auto response from the agent' },
    { agent },
  );
  assert.equal(toolResult.ok, true);
  await waitFor(() => (peer.getState().conversations[registry.instanceId] ?? []).some((message) => message.text === 'auto response from the agent'));
  const autoReply = peer.getState().conversations[registry.instanceId]
    .find((message) => message.text === 'auto response from the agent');
  assert.equal(autoReply.auto, true);

  await peer.send(registry.instanceId, 'this is already an auto reply', { auto: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(followups.length, 1);
});

test('auto-reply falls back to the default model when no agent session is open', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-link-auto-model-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const services = {
    agents: { roots: () => [] },
    agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'fake-model' }) },
    llm: {
      listProviders: () => [{ id: 'fake', name: 'Fake' }],
      listModels: async () => [{ id: 'fake-model', name: 'Fake model' }],
      async *stream() {
        yield { type: 'text-delta', index: 0, text: 'Auto reply from the default model' };
      },
    },
    tools: { register: () => () => {} },
    webServer: { tapIndex: () => () => {}, register: () => () => {} },
  };
  const { ctx, disposers } = fakeContext(services);
  apply(ctx, { name: 'Model auto host', transports: ['local'], autoReply: true });

  await waitFor(async () => {
    try {
      return (await fs.readdir(path.join(home, 'peer-link', 'instances'))).length === 1;
    } catch {
      return false;
    }
  });
  const registryFile = path.join(home, 'peer-link', 'instances', (await fs.readdir(path.join(home, 'peer-link', 'instances')))[0]);
  const registry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  const secret = Buffer.from((await fs.readFile(path.join(home, 'peer-link', 'secret.key'), 'utf8')).trim(), 'base64');
  const peer = new PeerLinkNode({
    stateDir: path.join(home, 'fake'),
    key: deriveKey(secret),
    name: 'Model auto peer',
    profileName: 'test',
    account: { signedIn: true, scope: registry.accountScope, label: 'Auto test' },
    config: {
      transports: ['local'],
      local: false,
      lan: false,
      manual: true,
      relay: false,
      relayUrl: '',
      relayToken: '',
      listenHost: '127.0.0.1',
      listenPort: 0,
      udpPort: 0,
      manualPeers: [],
      requireSameAccount: true,
      maxMessages: 50,
    },
    logger: quiet,
  });
  t.after(async () => {
    await peer.stop().catch(() => {});
    for (const dispose of disposers.reverse()) {
      try {
        await dispose?.();
      } catch {
        // best effort
      }
    }
  });
  await peer.start();
  peer.considerPeer({
    id: registry.instanceId,
    name: registry.name,
    accountScope: registry.accountScope,
    signedIn: true,
    endpoint: { host: '127.0.0.1', port: registry.port },
    source: 'manual',
  });
  await waitFor(() => peer.getState().peers.some((item) => item.id === registry.instanceId && item.online));
  await peer.send(registry.instanceId, 'reply from the fake model');

  await waitFor(() => {
    const conversation = peer.getState().conversations[registry.instanceId] ?? [];
    return conversation.some((message) => message.dir === 'in' && message.auto === true);
  });
  const reply = peer.getState().conversations[registry.instanceId]
    .find((message) => message.dir === 'in' && message.auto === true);
  assert.equal(reply.text, 'Auto reply from the default model');
});
