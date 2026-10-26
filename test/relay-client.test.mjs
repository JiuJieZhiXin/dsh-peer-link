import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveKey, randomId } from '../lib/protocol.js';
import { RelayClient } from '../lib/relay-client.js';

const KEY_A = deriveKey(Buffer.alloc(32, 1));
const KEY_B = deriveKey(Buffer.alloc(32, 2));
const ACCOUNT = 'a'.repeat(64);

const hub = {
  sockets: new Map(),
  queue: [],
  attach(socket) {
    this.sockets.set(socket.id, socket);
  },
  detach(socket) {
    this.sockets.delete(socket.id);
    this.broadcastPeers();
  },
  peers() {
    return [...this.sockets.values()].map((socket) => socket.meta).filter(Boolean);
  },
  find(instanceId) {
    for (const socket of this.sockets.values()) {
      if (socket.meta?.instanceId === instanceId) return socket;
    }
    return null;
  },
  broadcastPeers() {
    for (const socket of this.sockets.values()) {
      socket.deliver({ type: 'peers', peers: this.peers() });
    }
  },
  route(fromSocket, frame) {
    if (!fromSocket.meta && frame.type !== 'register') return;
    switch (frame.type) {
      case 'register': {
        fromSocket.meta = {
          instanceId: frame.instanceId,
          name: frame.name,
          profile: frame.profile,
          accountScope: frame.accountScope,
          signedIn: frame.signedIn,
        };
        fromSocket.deliver({ type: 'registered', peers: this.peers().filter((peer) => peer.instanceId !== frame.instanceId) });
        this.broadcastPeers();
        const queued = this.queue.filter((item) => item.to === frame.instanceId);
        this.queue = this.queue.filter((item) => item.to !== frame.instanceId);
        for (const item of queued) fromSocket.deliver(item.frame);
        break;
      }
      case 'hello': {
        const target = this.find(frame.to);
        if (!target?.meta) {
          fromSocket.deliver({ type: 'error', code: 'offline', ref: frame.nonce, error: 'peer is offline' });
          return;
        }
        target.deliver({ type: 'hello', from: fromSocket.meta.instanceId, nonce: frame.nonce });
        break;
      }
      case 'hello-ack': {
        const target = this.find(frame.to);
        target?.deliver(frame);
        break;
      }
      case 'message': {
        const target = this.find(frame.to);
        const deliver = {
          type: 'deliver',
          id: frame.id,
          to: frame.to,
          ts: frame.ts,
          nonce: frame.nonce,
          body: frame.body,
          sig: frame.sig,
          from: fromSocket.meta,
        };
        if (target) {
          target.deliver(deliver);
          fromSocket.deliver({ type: 'ack', id: frame.id, status: 'delivered' });
        } else {
          this.queue.push({ to: frame.to, frame: deliver });
          fromSocket.deliver({ type: 'ack', id: frame.id, status: 'queued' });
        }
        break;
      }
      case 'ping':
        fromSocket.deliver({ type: 'pong' });
        break;
      default:
        break;
    }
  },
};

let nextSocketId = 1;
class FakeWebSocket {
  constructor(url) {
    this.url = new URL(url);
    this.id = `socket-${nextSocketId++}`;
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

function makeNode() {
  return {
    received: [],
    acceptInbound(payload, options) {
      this.received.push({ payload, options });
    },
  };
}

function makeClient(instanceId, name, key, account = ACCOUNT) {
  const node = makeNode();
  const client = new RelayClient({
    url: 'wss://relay.test/peer',
    token: 'relay-token',
    key,
    node,
    instanceId,
    name,
    profile: 'test',
    accountScope: account,
    signedIn: true,
    logger: { warn() {}, info() {}, error() {} },
  });
  return { client, node };
}

async function waitFor(check, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out');
}

test('relay client handshakes, sends encrypted messages, and queues offline delivery', async (t) => {
  const a = makeClient('a'.repeat(32), 'Relay A', KEY_A);
  const b = makeClient('b'.repeat(32), 'Relay B', KEY_A);
  const wrong = makeClient('c'.repeat(32), 'Wrong key', KEY_B);
  t.after(() => {
    a.client.stop();
    b.client.stop();
    wrong.client.stop();
  });

  a.client.start();
  b.client.start();
  wrong.client.start();
  await waitFor(() => a.client.registered && b.client.registered && wrong.client.registered);

  const descriptor = await a.client.hello({ id: b.client.instanceId });
  assert.equal(descriptor.instanceId, b.client.instanceId);
  assert.equal(descriptor.accountScope, ACCOUNT);

  const message = { id: randomId(12), text: 'hello over relay', at: Date.now() };
  const ack = await a.client.sendMessage({ id: b.client.instanceId }, message);
  assert.equal(ack.status, 'delivered');
  await waitFor(() => b.node.received.length === 1);
  assert.equal(b.node.received[0].payload.text, 'hello over relay');
  assert.equal(b.node.received[0].payload.from.instanceId, a.client.instanceId);
  assert.equal(b.node.received[0].options.source, 'relay');

  await assert.rejects(
    () => a.client.hello({ id: wrong.client.instanceId }),
    /pairing key does not match/,
  );

  b.client.stop();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const offlineMessage = { id: randomId(12), text: 'queued while offline', at: Date.now() };
  const queued = await a.client.sendMessage({ id: b.client.instanceId }, offlineMessage);
  assert.equal(queued.status, 'queued');

  const b2 = makeClient(b.client.instanceId, 'Relay B restarted', KEY_A);
  t.after(() => b2.client.stop());
  b2.client.start();
  await waitFor(() => b2.client.registered);
  await waitFor(() => b2.node.received.length === 1);
  assert.equal(b2.node.received[0].payload.text, 'queued while offline');
});
