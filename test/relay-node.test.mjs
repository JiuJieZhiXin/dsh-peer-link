import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deriveKey, randomId } from '../lib/protocol.js';
import { PeerLinkNode } from '../lib/node.js';

const quiet = { info() {}, warn() {}, error() {} };
const KEY_A = deriveKey(Buffer.alloc(32, 3));
const KEY_B = deriveKey(Buffer.alloc(32, 4));
const ACCOUNT = { signedIn: true, scope: 'a'.repeat(64), label: 'Relay test' };
const CHANNEL = { token: 'relay-token' };

const hub = {
  sockets: new Map(),
  queue: new Map(),
  attach(socket) {
    this.sockets.set(socket.id, socket);
  },
  detach(socket) {
    this.sockets.delete(socket.id);
    this.broadcast();
  },
  find(instanceId) {
    for (const socket of this.sockets.values()) if (socket.meta?.instanceId === instanceId) return socket;
    return null;
  },
  peers() {
    return [...this.sockets.values()].map((socket) => socket.meta).filter(Boolean);
  },
  broadcast() {
    for (const socket of this.sockets.values()) socket.deliver({ type: 'peers', peers: this.peers() });
  },
  route(from, frame) {
    if (frame.type === 'register') {
      from.meta = {
        instanceId: frame.instanceId,
        name: frame.name,
        profile: frame.profile,
        accountScope: frame.accountScope,
        signedIn: frame.signedIn,
      };
      from.deliver({ type: 'registered', peers: this.peers().filter((peer) => peer.instanceId !== from.meta.instanceId) });
      this.broadcast();
      const queued = this.queue.get(frame.instanceId) ?? [];
      this.queue.delete(frame.instanceId);
      for (const item of queued) from.deliver(item);
      return;
    }
    if (frame.type === 'hello') {
      const target = this.find(frame.to);
      if (!target) {
        from.deliver({ type: 'error', code: 'offline', ref: frame.nonce, error: 'peer is offline' });
        return;
      }
      target.deliver({ type: 'hello', from: from.meta.instanceId, nonce: frame.nonce });
      return;
    }
    if (frame.type === 'hello-ack') {
      this.find(frame.to)?.deliver(frame);
      return;
    }
    if (frame.type === 'message') {
      const target = this.find(frame.to);
      const deliver = {
        type: 'deliver',
        id: frame.id,
        to: frame.to,
        ts: frame.ts,
        nonce: frame.nonce,
        body: frame.body,
        sig: frame.sig,
        from: from.meta,
      };
      if (target) {
        target.deliver(deliver);
        from.deliver({ type: 'ack', id: frame.id, status: 'delivered' });
      } else {
        const list = this.queue.get(frame.to) ?? [];
        list.push(deliver);
        this.queue.set(frame.to, list);
        from.deliver({ type: 'ack', id: frame.id, status: 'queued' });
      }
      return;
    }
    if (frame.type === 'ping') from.deliver({ type: 'pong' });
  },
};

let socketSeq = 1;
class FakeWebSocket {
  constructor(url) {
    this.url = new URL(url);
    this.id = `relay-socket-${socketSeq++}`;
    this.listeners = new Map();
    this.open = false;
    this.meta = null;
    hub.attach(this);
    setTimeout(() => {
      this.open = true;
      this.emit('open', {});
    }, 0);
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(raw) {
    if (!this.open) throw new Error('socket is not open');
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    hub.route(this, frame);
  }

  deliver(frame) {
    setTimeout(() => {
      if (this.open) this.emit('message', { data: JSON.stringify(frame) });
    }, 0);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    hub.detach(this);
    this.emit('close', {});
  }
}

globalThis.WebSocket = FakeWebSocket;

function makeNode(stateDir, key, name) {
  return new PeerLinkNode({
    stateDir,
    key,
    name,
    profileName: 'test',
    account: ACCOUNT,
    config: {
      transports: ['relay'],
      local: false,
      lan: false,
      manual: false,
      relay: true,
      relayUrl: 'wss://relay.test/peer',
      relayToken: CHANNEL.token,
      listenHost: '127.0.0.1',
      listenPort: 0,
      udpPort: 0,
      manualPeers: [],
      requireSameAccount: true,
      maxMessages: 50,
    },
    logger: quiet,
  });
}

async function waitFor(check, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('timed out');
}

test('two nodes handshake and exchange messages through the relay transport', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'peer-link-relay-node-'));
  const nodes = [];
  t.after(async () => {
    await Promise.all(nodes.map((node) => node.stop().catch(() => {})));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const a = makeNode(path.join(root, 'a'), KEY_A, 'Relay node A');
  const b = makeNode(path.join(root, 'b'), KEY_A, 'Relay node B');
  const c = makeNode(path.join(root, 'c'), KEY_B, 'Wrong relay node');
  nodes.push(a, b, c);
  await Promise.all([a.start(), b.start(), c.start()]);

  await waitFor(() => a.getState().peers.some((peer) => peer.id === b.instanceId && peer.online)
    && b.getState().peers.some((peer) => peer.id === a.instanceId && peer.online));
  const aPeer = a.getState().peers.find((peer) => peer.id === b.instanceId);
  const bPeer = b.getState().peers.find((peer) => peer.id === a.instanceId);
  assert.equal(aPeer.source, 'relay');
  assert.equal(bPeer.source, 'relay');

  const sent = await a.send(b.instanceId, 'hello through relay node');
  assert.equal(sent.delivered, true);
  assert.equal(sent.message.status, 'sent');
  await waitFor(() => b.getState().conversations[a.instanceId]?.length === 1);
  assert.equal(b.getState().conversations[a.instanceId][0].text, 'hello through relay node');

  await waitFor(() => a.getState().peers.find((peer) => peer.id === c.instanceId)?.keyMatch === false);
  assert.equal(a.getState().peers.find((peer) => peer.id === c.instanceId)?.online, true);
});
