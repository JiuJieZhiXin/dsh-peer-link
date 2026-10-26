import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  decryptBody,
  deriveKey,
  encryptBody,
  encryptionAad,
  keyFingerprint,
  helloProof,
  signRequest,
  verifyHelloProof,
  verifyRequest,
} from '../lib/protocol.js';
import { PeerLinkNode } from '../lib/node.js';

const quiet = { info() {}, warn() {}, error() {} };
const KEY = deriveKey(Buffer.alloc(32, 7));
const OTHER_KEY = deriveKey(Buffer.alloc(32, 9));

function makeNode(stateDir, key, name, extra = {}) {
  return new PeerLinkNode({
    stateDir,
    key,
    name,
    profileName: 'test',
    account: { signedIn: true, scope: 'account:test', label: 'Test account' },
    config: {
      listenHost: '127.0.0.1',
      listenPort: 0,
      lan: false,
      udpPort: 0,
      manualPeers: [],
      requireSameAccount: true,
      maxMessages: 50,
    },
    logger: quiet,
    ...extra,
  });
}

async function waitFor(check, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for condition');
}

test('request signatures and encrypted bodies round-trip', () => {
  const body = JSON.stringify({ hello: 'world' });
  const timestamp = Date.now();
  const nonce = 'a'.repeat(32);
  const aad = encryptionAad('POST', '/v1/message', timestamp, nonce);
  const signature = signRequest(KEY, 'POST', '/v1/message', timestamp, nonce, body);
  assert.equal(verifyRequest(KEY, 'POST', '/v1/message', timestamp, nonce, body, signature), true);
  assert.equal(verifyRequest(OTHER_KEY, 'POST', '/v1/message', timestamp, nonce, body, signature), false);

  const envelope = encryptBody(KEY, { text: 'secret' }, aad);
  assert.deepEqual(decryptBody(KEY, envelope, aad), { text: 'secret' });
  assert.equal(keyFingerprint(KEY).length, 16);

  const nonceTwo = 'b'.repeat(32);
  assert.equal(verifyHelloProof(KEY, nonceTwo, 'instance', helloProof(KEY, nonceTwo, 'instance')), true);
  assert.equal(verifyHelloProof(OTHER_KEY, nonceTwo, 'instance', helloProof(KEY, nonceTwo, 'instance')), false);
});

test('two nodes discover each other, exchange messages, and detect a wrong key', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'peer-link-test-'));
  const dirs = ['a', 'b', 'c'].map((name) => path.join(root, name));
  const nodes = [];
  t.after(async () => {
    await Promise.all(nodes.map((node) => node.stop().catch(() => {})));
    await rm(root, { recursive: true, force: true });
  });

  const a = makeNode(dirs[0], KEY, 'Alpha');
  const b = makeNode(dirs[1], KEY, 'Beta');
  const c = makeNode(dirs[2], OTHER_KEY, 'Wrong key');
  nodes.push(a, b, c);
  await Promise.all([a.start(), b.start(), c.start()]);

  a.considerPeer({
    id: b.instanceId,
    name: b.name,
    accountScope: 'account:test',
    signedIn: true,
    endpoint: { host: '127.0.0.1', port: b.port },
    source: 'test',
  });
  b.considerPeer({
    id: a.instanceId,
    name: a.name,
    accountScope: 'account:test',
    signedIn: true,
    endpoint: { host: '127.0.0.1', port: a.port },
    source: 'test',
  });

  await waitFor(() => a.getState().peers.some((peer) => peer.id === b.instanceId && peer.online));
  await waitFor(() => b.getState().peers.some((peer) => peer.id === a.instanceId && peer.online));

  const sent = await a.send(b.instanceId, 'hello from Alpha');
  assert.equal(sent.delivered, true);
  assert.equal(sent.message.status, 'sent');

  await waitFor(() => b.getState().conversations[a.instanceId]?.length === 1);
  const received = b.getState().conversations[a.instanceId][0];
  assert.equal(received.text, 'hello from Alpha');
  assert.equal(received.dir, 'in');

  const inbound = [];
  b.on('inbound', (event) => inbound.push(event));
  const autoSent = await a.send(b.instanceId, 'auto hello', { auto: true });
  assert.equal(autoSent.message.auto, true);
  await waitFor(() => b.getState().conversations[a.instanceId]?.length === 2);
  const autoReceived = b.getState().conversations[a.instanceId][1];
  assert.equal(autoReceived.auto, true);
  assert.equal(inbound.at(-1)?.message?.auto, true);

  await b.send(a.instanceId, 'hello back');
  await waitFor(() => a.getState().conversations[b.instanceId]?.length === 3);

  a.considerPeer({
    id: c.instanceId,
    name: c.name,
    accountScope: 'account:test',
    signedIn: true,
    endpoint: { host: '127.0.0.1', port: c.port },
    source: 'test',
  });
  await waitFor(() => a.getState().peers.find((peer) => peer.id === c.instanceId)?.keyMatch === false);
  assert.equal(a.getState().peers.find((peer) => peer.id === c.instanceId)?.online, true);
});
