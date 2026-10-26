import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { loadInstanceId } from '../index.js';
import { PeerLinkNode } from '../lib/node.js';

const quiet = { info() {}, warn() {}, error() {} };

function nodeConfig() {
  return {
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
  };
}

test('instance identity is stable across restarts and prefers the newest profile entry', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-link-identity-'));
  t.after(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const stateDir = path.join(home, 'state');
  const registryDir = path.join(home, 'instances');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(registryDir, { recursive: true });
  const write = async (name, value) => fs.writeFile(path.join(registryDir, name), JSON.stringify(value));
  await write('old.json', { profile: 'desktop', instanceId: 'a'.repeat(32), updatedAt: 1 });
  await write('new.json', { profile: 'desktop', instanceId: 'b'.repeat(32), updatedAt: 9 });
  await write('other.json', { profile: 'peer-test', instanceId: 'c'.repeat(32), updatedAt: 99 });

  const first = await loadInstanceId(stateDir, registryDir, 'desktop');
  assert.equal(first, 'b'.repeat(32));
  const second = await loadInstanceId(stateDir, registryDir, 'desktop');
  assert.equal(second, first);
  assert.equal((await fs.readFile(path.join(stateDir, 'instance-id'), 'utf8')).trim(), first);
});

test('offline peers without history are pruned and forget removes history', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-link-prune-'));
  t.after(async () => {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const node = new PeerLinkNode({
    stateDir: home,
    instanceId: '1'.repeat(32),
    key: randomBytes(32),
    name: 'Prune host',
    profileName: 'test',
    account: { signedIn: false, scope: 'local:test' },
    config: nodeConfig(),
    logger: quiet,
  });
  assert.equal(node.instanceId, '1'.repeat(32));

  const ghostId = '2'.repeat(32);
  node.considerPeer({
    id: ghostId,
    name: 'Ghost',
    accountScope: 'local:test',
    endpoint: { host: '127.0.0.1', port: 9 },
    source: 'manual',
  });
  node.peers.get(ghostId).lastSeen = 0;
  node.peers.get(ghostId).inflight = false;
  node.inflight.delete(ghostId);
  node.pruneOfflinePeers(Date.now());
  assert.equal(node.peers.has(ghostId), false);

  const historyId = '3'.repeat(32);
  node.considerPeer({
    id: historyId,
    name: 'History',
    accountScope: 'local:test',
    endpoint: { host: '127.0.0.1', port: 9 },
    source: 'manual',
  });
  node.store.addMessage(historyId, { id: 'message-1', dir: 'in', text: 'keep me', at: Date.now(), status: 'received' });
  node.forgetPeer(historyId);
  assert.equal(node.peers.has(historyId), false);
  assert.deepEqual(node.store.listMessages(historyId, 0), []);
  await node.store.flush();
});
