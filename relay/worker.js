/**
 * Optional Cloudflare Worker relay for Peer Link.
 *
 * One Durable Object per account scope. WebSockets use the Hibernation API so
 * an idle relay consumes no Durable Object duration. The relay only forwards
 * opaque, signed envelopes; it never receives the pairing key or plaintext.
 */
const MAX_QUEUE_PER_PEER = 100;
const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class PeerRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS relay_queue (
        id TEXT PRIMARY KEY,
        to_id TEXT NOT NULL,
        frame TEXT NOT NULL,
        created INTEGER NOT NULL
      )
    `);
  }

  async fetch(request) {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // `acceptWebSocket` is the Hibernation API; it also accepts the socket.
    // Do not call server.accept() first: that would pin the object in memory
    // and incur duration charges for the entire connection.
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let frame;
    try {
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    switch (frame.type) {
      case 'register':
        this.register(ws, frame);
        break;
      case 'hello':
      case 'hello-ack':
        this.routeSignal(ws, frame);
        break;
      case 'message':
        this.routeMessage(ws, frame);
        break;
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
      default:
        break;
    }
  }

  webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    this.broadcastPeers();
  }

  webSocketError(ws, error) {
    this.broadcastPeers();
  }

  register(ws, frame) {
    const instanceId = typeof frame.instanceId === 'string' ? frame.instanceId : '';
    const accountScope = typeof frame.accountScope === 'string' ? frame.accountScope : '';
    if (!/^[0-9a-zA-Z_-]{8,80}$/.test(instanceId) || !/^[a-f0-9]{16,64}$/.test(accountScope)) {
      this.send(ws, { type: 'error', code: 'invalid-register', error: 'invalid instance or account scope' });
      try {
        ws.close(4000, 'invalid registration');
      } catch {
        // already closed
      }
      return;
    }
    const meta = {
      instanceId,
      name: typeof frame.name === 'string' ? frame.name.slice(0, 80) : instanceId.slice(0, 8),
      profile: typeof frame.profile === 'string' ? frame.profile.slice(0, 40) : '',
      accountScope,
      signedIn: frame.signedIn === true,
    };
    ws.serializeAttachment(meta);
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const otherMeta = attachmentOf(other);
      if (otherMeta?.instanceId === instanceId) {
        try {
          other.close(4001, 'replaced by a newer connection');
        } catch {
          // already closed
        }
      }
    }
    this.send(ws, { type: 'registered', peers: this.peerList() });
    this.flushQueue(ws, instanceId);
    this.broadcastPeers();
  }

  routeSignal(ws, frame) {
    const meta = attachmentOf(ws);
    if (!meta || typeof frame.to !== 'string' || !frame.to) return;
    const target = this.find(frame.to);
    if (!target) {
      this.send(ws, {
        type: 'error',
        code: 'offline',
        ref: frame.nonce ?? frame.id ?? null,
        error: 'peer is offline',
      });
      return;
    }
    const outgoing = { ...frame, from: meta.instanceId };
    delete outgoing.token;
    this.send(target, outgoing);
  }

  routeMessage(ws, frame) {
    const meta = attachmentOf(ws);
    if (!meta) return;
    if (typeof frame.id !== 'string' || typeof frame.to !== 'string' || typeof frame.body !== 'string' || typeof frame.sig !== 'string') {
      this.send(ws, { type: 'error', code: 'invalid-message', ref: frame.id ?? null, error: 'malformed message' });
      return;
    }
    const target = this.find(frame.to);
    const deliver = {
      type: 'deliver',
      id: frame.id,
      to: frame.to,
      ts: frame.ts,
      nonce: frame.nonce,
      body: frame.body,
      sig: frame.sig,
      from: {
        instanceId: meta.instanceId,
        name: meta.name,
        profile: meta.profile,
        accountScope: meta.accountScope,
        signedIn: meta.signedIn,
      },
    };
    if (target) {
      if (this.send(target, deliver)) {
        this.send(ws, { type: 'ack', id: frame.id, status: 'delivered' });
        return;
      }
    }
    this.enqueue(deliver);
    this.send(ws, { type: 'ack', id: frame.id, status: 'queued' });
  }

  flushQueue(ws, instanceId) {
    const sql = this.state.storage.sql;
    const rows = [...sql.exec(
      'SELECT frame FROM relay_queue WHERE to_id = ? ORDER BY created ASC LIMIT ?',
      instanceId,
      MAX_QUEUE_PER_PEER,
    )];
    if (rows.length === 0) return;
    let sent = 0;
    for (const row of rows) {
      try {
        ws.send(String(row.frame));
        sent += 1;
      } catch {
        break;
      }
    }
    if (sent > 0) {
      sql.exec(
        `DELETE FROM relay_queue WHERE rowid IN (
          SELECT rowid FROM relay_queue WHERE to_id = ? ORDER BY created ASC LIMIT ?
        )`,
        instanceId,
        sent,
      );
    }
  }

  enqueue(frame) {
    const sql = this.state.storage.sql;
    sql.exec(
      'INSERT OR REPLACE INTO relay_queue (id, to_id, frame, created) VALUES (?, ?, ?, ?)',
      frame.id,
      frame.to,
      JSON.stringify(frame),
      Date.now(),
    );
    sql.exec(
      `DELETE FROM relay_queue WHERE to_id = ? AND id NOT IN (
        SELECT id FROM relay_queue WHERE to_id = ? ORDER BY created DESC LIMIT ?
      )`,
      frame.to,
      frame.to,
      MAX_QUEUE_PER_PEER,
    );
    sql.exec('DELETE FROM relay_queue WHERE created < ?', Date.now() - QUEUE_TTL_MS);
  }

  peerList() {
    const seen = new Set();
    const peers = [];
    for (const socket of this.state.getWebSockets()) {
      if (!isOpen(socket)) continue;
      const meta = attachmentOf(socket);
      if (!meta || seen.has(meta.instanceId)) continue;
      seen.add(meta.instanceId);
      peers.push({
        instanceId: meta.instanceId,
        name: meta.name,
        profile: meta.profile,
        accountScope: meta.accountScope,
        signedIn: meta.signedIn,
      });
    }
    return peers;
  }

  find(instanceId) {
    for (const socket of this.state.getWebSockets()) {
      if (!isOpen(socket)) continue;
      const meta = attachmentOf(socket);
      if (meta?.instanceId === instanceId) return socket;
    }
    return null;
  }

  broadcastPeers() {
    const peers = this.peerList();
    for (const socket of this.state.getWebSockets()) {
      if (!isOpen(socket)) continue;
      this.send(socket, { type: 'peers', peers });
    }
  }

  send(ws, frame) {
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }
}

function attachmentOf(ws) {
  try {
    return ws.deserializeAttachment() ?? null;
  } catch {
    return null;
  }
}

function isOpen(ws) {
  try {
    return ws.readyState === 1;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname !== '/peer') {
      return new Response('not found', { status: 404 });
    }
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    if (!env.RELAY_TOKEN) {
      return new Response('relay token is not configured', { status: 500 });
    }
    const token = url.searchParams.get('token') ?? '';
    if (!(await constantTimeEqual(token, env.RELAY_TOKEN))) {
      return new Response('unauthorized', { status: 401 });
    }
    const account = url.searchParams.get('account') ?? '';
    if (!/^[a-f0-9]{16,64}$/.test(account)) {
      return new Response('invalid account scope', { status: 400 });
    }
    const id = env.PEER_ROOM.idFromName(account);
    return env.PEER_ROOM.get(id).fetch(request);
  },
};

async function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(left))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(right))),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < aa.length; index += 1) diff |= aa[index] ^ bb[index];
  return diff === 0;
}
