/**
 * Peer Link transport, presence, discovery, and delivery.
 *
 * A node owns one HTTP listener (the peer transport), one optional UDP
 * multicast socket (LAN presence), and one local registry heartbeat. It has no
 * Cordis dependency, which keeps the protocol testable in plain Node and lets
 * the Host glue stay focused on account identity, tools, and the Web UI.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import {
  CLOCK_SKEW_MS,
  DEFAULT_MAX_TEXT,
  DEFAULT_UDP_PORT,
  MAX_BODY_BYTES,
  MULTICAST_GROUP,
  PROTOCOL,
  VERSION,
  clampText,
  decryptBody,
  encryptBody,
  encryptionAad,
  formatHost,
  helloProof,
  keyFingerprint,
  normalizeRemoteAddress,
  randomId,
  randomNonce,
  signRequest,
  truncate,
  verifyHelloProof,
  verifyRequest,
} from './protocol.js';
import { RelayClient } from './relay-client.js';
import { MessageStore } from './store.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const REGISTRY_STALE_MS = 30_000;
const REGISTRY_HEARTBEAT_MS = 5_000;
const SCAN_INTERVAL_MS = 2_500;
const MAINTENANCE_INTERVAL_MS = 8_000;
const PRESENCE_INTERVAL_MS = 15_000;
const MANUAL_PROBE_INTERVAL_MS = 60_000;
const OFFLINE_PEER_TTL_MS = 10 * 60_000;

export class PeerLinkNode extends EventEmitter {
  constructor(options) {
    super();
    this.logger = options.logger ?? console;
    this.config = options.config;
    this.stateDir = options.stateDir;
    this.key = options.key;
    this.account = normalizeAccount(options.account);
    this.instanceId = options.instanceId ?? randomId();
    this.name = options.name;
    this.profileName = options.profileName ?? '';
    this.startedAt = Date.now();
    this.self = {
      instanceId: this.instanceId,
      name: this.name,
      profile: this.profileName,
      account: this.account,
      port: 0,
      version: VERSION,
      protocol: PROTOCOL,
      transports: this.config.transports,
    };
    this.store = new MessageStore(path.join(this.stateDir, 'messages.json'), {
      maxMessages: this.config.maxMessages,
      logger: this.logger,
    });
    this.peers = new Map();
    this.mismatches = new Set();
    this.server = null;
    this.port = 0;
    this.udp = null;
    this.relay = null;
    this.udpTimer = null;
    this.heartbeatTimer = null;
    this.scanTimer = null;
    this.maintenanceTimer = null;
    this.stopped = false;
    this.started = false;
    this.inflight = new Map();
    this.flushing = new Set();
    this.nonces = new Map();
    this.rate = new Map();
    this.changeTimer = null;
    this.lastError = null;
    this.lanError = null;
    this.manualError = null;
    this.lastManualProbe = 0;
    this.startedPromise = null;
    this.registryDir = options.registryDir ?? path.join(this.stateDir, 'instances');
    this.registryFile = path.join(this.registryDir, `${this.instanceId}.json`);
  }

  get ready() {
    return this.startedPromise ?? Promise.resolve();
  }

  async start() {
    this.startedPromise = this.startInternal();
    return this.startedPromise;
  }

  async startInternal() {
    await fs.mkdir(this.registryDir, { recursive: true });
    await this.store.load();
    this.restorePeers();

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    this.server.headersTimeout = 8_000;
    this.server.requestTimeout = 15_000;
    this.server.keepAliveTimeout = 5_000;
    this.server.on('clientError', (_error, socket) => {
      socket.destroy();
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.config.listenPort, this.config.listenHost);
    }).catch((error) => {
      this.lastError = `listen failed: ${error?.message ?? error}`;
      throw error;
    });

    this.port = this.server.address().port;
    this.self.port = this.port;
    this.started = true;

    if (this.config.local) {
      await this.writeRegistry();
      this.heartbeatTimer = setInterval(() => {
        void this.writeRegistry();
      }, REGISTRY_HEARTBEAT_MS);
      this.heartbeatTimer.unref?.();
    }

    this.scanTimer = setInterval(() => {
      void this.scanRegistry();
      this.maintain();
    }, SCAN_INTERVAL_MS);
    this.scanTimer.unref?.();

    this.maintenanceTimer = setInterval(() => {
      this.maintain();
      this.cleanupReplay();
      void this.probeManualPeers();
    }, MAINTENANCE_INTERVAL_MS);
    this.maintenanceTimer.unref?.();

    if (this.config.lan) {
      await this.startUdp();
    }
    if (this.config.relay) {
      this.startRelay();
    }

    void this.scanRegistry();
    void this.probeManualPeers();
    this.emitChange();
    this.logger.info?.(
      `[peer-link] listening on ${this.config.listenHost}:${this.port} as ${this.name}`,
    );
    return this;
  }

  restorePeers() {
    for (const saved of this.store.listPeers()) {
      if (!saved || typeof saved.id !== 'string' || saved.id === this.instanceId) continue;
      if (this.config.requireSameAccount
        && saved.accountScope
        && saved.accountScope !== this.account.scope) {
        continue;
      }
      const peer = this.makePeer({
        id: saved.id,
        name: saved.name,
        profile: saved.profile,
        accountScope: saved.accountScope,
        signedIn: saved.signedIn,
        endpoint: saved.endpoint,
        source: 'history',
      });
      peer.lastSeen = Number(saved.lastSeen ?? 0);
      peer.keyMatch = saved.keyMatch === false ? false : null;
      this.peers.set(peer.id, peer);
    }
  }

  makePeer(input) {
    return {
      id: input.id,
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : '',
      profile: typeof input.profile === 'string' ? input.profile : '',
      accountScope: typeof input.accountScope === 'string' ? input.accountScope : '',
      signedIn: input.signedIn === true,
      endpoint: normalizeEndpoint(input.endpoint),
      source: input.source ?? 'local',
      online: false,
      keyMatch: null,
      lastSeen: Number(input.lastSeen ?? 0),
      firstSeen: Number(input.firstSeen ?? Date.now()),
      failures: 0,
      nextAttemptAt: 0,
      inflight: false,
      lastError: null,
    };
  }

  considerPeer(input) {
    if (this.stopped || !input || typeof input.id !== 'string' || input.id.length < 8) return null;
    if (input.id === this.instanceId) return null;
    if (this.config.requireSameAccount && input.accountScope !== this.account.scope) {
      this.mismatches.add(input.id);
      if (this.peers.delete(input.id)) this.emitChange();
      return null;
    }
    this.mismatches.delete(input.id);

    let peer = this.peers.get(input.id);
    let created = false;
    let changed = false;
    if (!peer) {
      peer = this.makePeer(input);
      this.peers.set(peer.id, peer);
      created = true;
      changed = true;
    }

    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    if (name && name !== peer.name) {
      peer.name = name;
      changed = true;
    }
    const endpoint = normalizeEndpoint(input.endpoint);
    if (endpoint && (!peer.endpoint || peer.endpoint.host !== endpoint.host || peer.endpoint.port !== endpoint.port)) {
      peer.endpoint = endpoint;
      peer.nextAttemptAt = 0;
      changed = true;
    }
    if (typeof input.profile === 'string' && input.profile !== peer.profile) {
      peer.profile = input.profile;
      changed = true;
    }
    if (typeof input.accountScope === 'string' && input.accountScope !== peer.accountScope) {
      peer.accountScope = input.accountScope;
      changed = true;
    }
    if (typeof input.signedIn === 'boolean' && input.signedIn !== peer.signedIn) {
      peer.signedIn = input.signedIn;
      changed = true;
    }
    if (typeof input.source === 'string' && input.source !== peer.source) {
      // Keep the stronger direct route when both a direct address and a relay
      // presence describe the same instance; relay-only peers have no endpoint.
      if (!peer.endpoint || peer.source === 'history') peer.source = input.source;
    }

    if (changed) this.persistPeer(peer);
    if (created) this.emitChange();

    const relayReady = peer.source === 'relay' && this.relay?.registered;
    if ((peer.endpoint || relayReady) && !peer.inflight && !this.stopped) {
      const due = peer.nextAttemptAt === 0 || Date.now() >= peer.nextAttemptAt;
      if (due && (created || !peer.online || Date.now() - peer.lastSeen > PRESENCE_INTERVAL_MS)) {
        void this.handshake(peer);
      }
    }
    return peer;
  }

  persistPeer(peer) {
    this.store.upsertPeer(peer.id, {
      id: peer.id,
      name: peer.name,
      profile: peer.profile,
      accountScope: peer.accountScope,
      signedIn: peer.signedIn,
      endpoint: peer.endpoint,
      lastSeen: peer.lastSeen,
      keyMatch: peer.keyMatch === false ? false : undefined,
    });
  }

  async handshake(peer) {
    if (this.stopped || peer.inflight) return false;
    if (peer.source === 'relay') {
      if (!this.relay?.registered) return false;
    } else if (!peer.endpoint) {
      return false;
    }
    peer.inflight = true;
    this.inflight.set(peer.id, true);
    try {
      let response;
      if (peer.source === 'relay') {
        response = await this.relay.hello(peer);
        if (response.protocol !== undefined && response.protocol !== PROTOCOL) {
          throw new Error(`peer protocol ${response.protocol} is not ${PROTOCOL}`);
        }
        if (response.instanceId !== peer.id) throw new Error('peer identity changed during handshake');
      } else {
        const nonce = randomNonce();
        const base = this.endpointOrigin(peer.endpoint);
        response = await fetchJson(`${base}/v1/hello?nonce=${nonce}`, { timeout: 3_500 });
        if (response.protocol !== PROTOCOL) throw new Error(`peer protocol ${response.protocol} is not ${PROTOCOL}`);
        if (response.instanceId !== peer.id) throw new Error('peer identity changed during handshake');
        if (!verifyHelloProof(this.key, nonce, peer.id, response.proof)) {
          const error = new Error('pairing key does not match this instance');
          error.code = 'KEY_MISMATCH';
          throw error;
        }
      }
      if (this.config.requireSameAccount
        && response.accountScope !== this.account.scope) {
        const error = new Error('peer is signed in to a different account');
        error.code = 'ACCOUNT_MISMATCH';
        throw error;
      }

      const wasOnline = peer.online;
      const wasMismatch = peer.keyMatch === false;
      peer.online = true;
      peer.keyMatch = true;
      peer.failures = 0;
      peer.lastSeen = Date.now();
      peer.nextAttemptAt = Date.now() + PRESENCE_INTERVAL_MS;
      peer.lastError = null;
      if (typeof response.name === 'string' && response.name.trim()) peer.name = response.name.trim().slice(0, 80);
      if (typeof response.profile === 'string') peer.profile = response.profile;
      if (typeof response.signedIn === 'boolean') peer.signedIn = response.signedIn;
      if (typeof response.accountScope === 'string') peer.accountScope = response.accountScope;
      this.persistPeer(peer);
      if (!wasOnline || wasMismatch) this.emitChange();
      void this.flushPending(peer);
      return true;
    } catch (error) {
      const now = Date.now();
      peer.failures += 1;
      const keyMismatch = error?.code === 'KEY_MISMATCH' || error?.code === 'ACCOUNT_MISMATCH';
      const wasOnline = peer.online;
      const wasKeyMatch = peer.keyMatch;
      peer.lastError = truncate(error?.message ?? String(error), 240);
      if (keyMismatch) {
        peer.online = true;
        peer.keyMatch = false;
        peer.nextAttemptAt = now + 30_000;
      } else {
        peer.online = false;
        if (peer.failures >= 2) peer.keyMatch = peer.keyMatch === true ? true : null;
        peer.nextAttemptAt = now + Math.min(60_000, 3_000 * 2 ** Math.min(peer.failures, 4));
      }
      if (peer.lastError && !keyMismatch) this.lastError = peer.lastError;
      this.persistPeer(peer);
      if (wasOnline !== peer.online || wasKeyMatch !== peer.keyMatch) this.emitChange();
      return false;
    } finally {
      peer.inflight = false;
      this.inflight.delete(peer.id);
    }
  }

  async send(peerRef, rawText, options = {}) {
    const peer = this.resolvePeer(peerRef);
    const text = clampText(rawText, DEFAULT_MAX_TEXT);
    if (peer.keyMatch === false) {
      throw new Error('this peer uses a different pairing key; configure the same sharedSecret on both instances');
    }
    if (this.config.requireSameAccount && peer.accountScope !== this.account.scope) {
      throw new Error('this peer is signed in to a different account');
    }
    const message = {
      id: randomId(12),
      dir: 'out',
      text,
      at: Date.now(),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      auto: options.auto === true,
    };
    this.store.addMessage(peer.id, message);
    this.emitChange();
    const delivered = await this.deliver(peer, message);
    return {
      ok: true,
      delivered,
      peer: { id: peer.id, name: peerDisplayName(peer) },
      message: { ...message },
    };
  }

  async deliver(peer, message) {
    if (this.stopped) return false;
    if (peer.source === 'relay') return this.deliverRelay(peer, message);
    if (!peer.online || !peer.endpoint) {
      this.touchRetry(peer, message);
      return false;
    }
    if (peer.keyMatch === false) return false;
    try {
      const timestamp = Date.now();
      const nonce = randomNonce();
      const pathname = '/v1/message';
      const aad = encryptionAad('POST', pathname, timestamp, nonce);
      const payload = {
        id: message.id,
        text: message.text,
        sentAt: message.at,
        auto: message.auto === true,
        from: {
          instanceId: this.self.instanceId,
          name: this.name,
          profile: this.profileName,
          port: this.port,
          accountScope: this.account.scope,
          signedIn: this.account.signedIn,
        },
        to: peer.id,
      };
      const body = JSON.stringify(encryptBody(this.key, payload, aad));
      const signature = signRequest(this.key, 'POST', pathname, timestamp, nonce, body);
      const response = await fetchJson(`${this.endpointOrigin(peer.endpoint)}${pathname}`, {
        method: 'POST',
        timeout: 7_000,
        headers: {
          'content-type': 'application/json',
          'x-peer-protocol': String(PROTOCOL),
          'x-peer-instance': this.instanceId,
          'x-peer-timestamp': String(timestamp),
          'x-peer-nonce': nonce,
          'x-peer-signature': signature,
        },
        body,
      });
      if (response.ok !== true) throw new Error(response.error || 'peer rejected the message');
      this.store.updateMessage(peer.id, message.id, {
        status: 'sent',
        deliveredAt: Date.now(),
        error: null,
        nextAttemptAt: 0,
      });
      peer.online = true;
      peer.keyMatch = true;
      peer.lastSeen = Date.now();
      peer.failures = 0;
      this.persistPeer(peer);
      this.emitChange();
      return true;
    } catch (error) {
      message.attempts = Number(message.attempts ?? 0) + 1;
      message.status = 'failed';
      message.error = truncate(error?.message ?? String(error), 200);
      message.nextAttemptAt = Date.now() + Math.min(30_000, 1_500 * message.attempts);
      this.store.updateMessage(peer.id, message.id, {
        attempts: message.attempts,
        status: message.status,
        error: message.error,
        nextAttemptAt: message.nextAttemptAt,
      });
      this.emitChange();
      return false;
    }
  }

  async deliverRelay(peer, message) {
    if (!this.relay?.registered) {
      this.touchRetry(peer, message);
      return false;
    }
    try {
      const ack = await this.relay.sendMessage(peer, message);
      const delivered = ack.status === 'delivered';
      this.store.updateMessage(peer.id, message.id, {
        status: delivered ? 'sent' : 'queued',
        deliveredAt: delivered ? Date.now() : null,
        error: null,
        nextAttemptAt: 0,
      });
      peer.online = true;
      peer.keyMatch = true;
      peer.lastSeen = Date.now();
      peer.failures = 0;
      this.persistPeer(peer);
      this.emitChange();
      return delivered;
    } catch (error) {
      message.attempts = Number(message.attempts ?? 0) + 1;
      message.status = 'failed';
      message.error = truncate(error?.message ?? String(error), 200);
      message.nextAttemptAt = Date.now() + Math.min(30_000, 1_500 * message.attempts);
      this.store.updateMessage(peer.id, message.id, {
        attempts: message.attempts,
        status: message.status,
        error: message.error,
        nextAttemptAt: message.nextAttemptAt,
      });
      this.emitChange();
      return false;
    }
  }

  touchRetry(_peer, message) {
    message.attempts = Number(message.attempts ?? 0);
    message.nextAttemptAt = Date.now() + 2_000;
    this.store.updateMessage(_peer.id, message.id, {
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt,
    });
  }

  async flushPending(peer) {
    if (this.stopped || !peer.online || peer.keyMatch === false || this.flushing.has(peer.id)) return;
    this.flushing.add(peer.id);
    try {
      const pending = this.store
        .listMessages(peer.id, 0)
        .filter((message) => message.dir === 'out'
          && (message.status === 'pending' || message.status === 'failed')
          && Number(message.attempts ?? 0) < 20
          && Number(message.nextAttemptAt ?? 0) <= Date.now())
        .slice(0, 8);
      for (const message of pending) {
        if (!peer.online) break;
        await this.deliver(peer, message);
      }
    } finally {
      this.flushing.delete(peer.id);
    }
  }

  resolvePeer(ref) {
    const value = typeof ref === 'string' ? ref.trim() : '';
    if (!value) throw new Error('peer is required (id or display name)');
    const exactId = this.peers.get(value);
    if (exactId) return exactId;
    const lower = value.toLowerCase();
    const exactName = [...this.peers.values()].filter((peer) => peerDisplayName(peer).toLowerCase() === lower);
    if (exactName.length === 1) return exactName[0];
    const matches = [...this.peers.values()].filter((peer) =>
      peer.id.toLowerCase().startsWith(lower)
      || peerDisplayName(peer).toLowerCase().includes(lower));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(`peer "${value}" is ambiguous: ${matches.map((peer) => peerDisplayName(peer)).join(', ')}`);
    }
    throw new Error(`peer "${value}" is not known on this instance`);
  }

  markRead(peerRef) {
    const peer = this.resolvePeer(peerRef);
    this.store.markRead(peer.id);
    this.emitChange();
    return { ok: true, peer: { id: peer.id, name: peerDisplayName(peer) } };
  }

  forgetPeer(peerRef) {
    const peer = this.resolvePeer(peerRef);
    if (peer.online) throw new Error('cannot forget a peer while it is online');
    this.peers.delete(peer.id);
    this.mismatches.delete(peer.id);
    this.store.removePeer(peer.id);
    this.emitChange();
    return { ok: true, peer: { id: peer.id, name: peerDisplayName(peer) } };
  }

  listPeerSummaries() {
    return [...this.peers.values()]
      .map((peer) => {
        const last = this.store.lastMessage(peer.id);
        return {
          id: peer.id,
          name: peerDisplayName(peer),
          profile: peer.profile,
          online: Boolean(peer.online),
          keyMatch: peer.keyMatch,
          signedIn: Boolean(peer.signedIn),
          source: peer.source,
          lastSeen: peer.lastSeen,
          lastError: peer.lastError,
          unread: this.store.unread(peer.id),
          messageCount: this.store.listMessages(peer.id, 0).length,
          lastMessage: last
            ? { text: truncate(last.text, 160), at: last.at, dir: last.dir, status: last.status }
            : null,
        };
      })
      .sort((left, right) => {
        if (left.online !== right.online) return left.online ? -1 : 1;
        const leftAt = left.lastMessage?.at ?? left.lastSeen;
        const rightAt = right.lastMessage?.at ?? right.lastSeen;
        return rightAt - leftAt;
      });
  }

  getState() {
    const peers = this.listPeerSummaries();
    const conversations = {};
    for (const peer of peers) conversations[peer.id] = this.store.listMessages(peer.id, 250);
    const unread = peers.reduce((total, peer) => total + Number(peer.unread ?? 0), 0);
    return {
      ready: this.started,
      protocol: PROTOCOL,
      version: VERSION,
      self: {
        instanceId: this.instanceId,
        name: this.name,
        profile: this.profileName,
        account: {
          signedIn: this.account.signedIn,
          label: this.account.label,
        },
        port: this.port,
        endpoint: this.publicEndpoint(),
        lan: this.config.lan,
        lanAddresses: this.config.lan ? lanAddresses() : [],
        keyFingerprint: keyFingerprint(this.key),
        transports: this.config.transports,
        autoReply: this.config.autoReply === true,
        relay: {
          enabled: this.config.relay,
          connected: Boolean(this.relay?.connected),
          error: this.relay?.error
            ?? (this.config.relay && !this.config.relayUrl ? 'relayUrl is not configured' : null),
        },
        startedAt: this.startedAt,
      },
      peers,
      conversations,
      presets: {
        transports: this.config.transports,
        manualPeers: [...this.config.manualPeers],
        listenPort: this.config.listenPort,
        lan: this.config.lan,
        relayUrl: this.config.relayUrl,
        requireSameAccount: this.config.requireSameAccount,
      },
      stats: {
        online: peers.filter((peer) => peer.online).length,
        known: peers.length,
        unread,
        mismatched: this.mismatches.size,
      },
      errors: {
        lan: this.lanError,
        manual: this.manualError,
        last: this.lastError,
      },
    };
  }

  publicEndpoint() {
    if (this.config.lan) {
      const address = lanAddresses().find((item) => item.address)?.address;
      if (address) return `http://${formatHost(address)}:${this.port}`;
    }
    return `http://127.0.0.1:${this.port}`;
  }

  updateAccount(account) {
    const next = normalizeAccount(account);
    if (next.scope === this.account.scope) {
      this.account = next;
      this.self.account = next;
      void this.writeRegistry();
      this.emitChange();
      return;
    }
    this.account = next;
    this.self.account = next;
    for (const [id, peer] of this.peers) {
      if (this.config.requireSameAccount && peer.accountScope !== next.scope) {
        this.peers.delete(id);
        this.mismatches.add(id);
      }
    }
    if (this.relay) {
      const relay = this.relay;
      this.relay = null;
      relay.stop();
      if (this.config.relay) this.startRelay();
    }
    void this.writeRegistry();
    this.emitChange();
    void this.scanRegistry();
  }

  maintain() {
    if (this.stopped) return;
    const now = Date.now();
    for (const peer of this.peers.values()) {
      if (peer.inflight) continue;
      if (!peer.endpoint && !(peer.source === 'relay' && this.relay?.registered)) continue;
      if (peer.source === 'relay' && peer.online) {
        void this.flushPending(peer);
        continue;
      }
      if (now < peer.nextAttemptAt) continue;
      if (!peer.online || now - peer.lastSeen > PRESENCE_INTERVAL_MS) {
        void this.handshake(peer);
      } else {
        void this.flushPending(peer);
      }
    }
    this.pruneOfflinePeers(now);
  }

  pruneOfflinePeers(now) {
    let changed = false;
    for (const [peerId, peer] of this.peers) {
      if (peer.online || peer.inflight || this.inflight.has(peerId)) continue;
      if (this.store.listMessages(peerId, 0).length > 0) continue;
      if (now - Number(peer.lastSeen ?? 0) < OFFLINE_PEER_TTL_MS) continue;
      this.peers.delete(peerId);
      this.mismatches.delete(peerId);
      this.store.removePeer(peerId);
      changed = true;
    }
    if (changed) this.emitChange();
  }

  async scanRegistry() {
    if (this.stopped || !this.config.local) return;
    const dir = this.registryDir;
    let entries = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    const now = Date.now();
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      let data;
      try {
        data = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch {
        continue;
      }
      if (!data || data.protocol !== PROTOCOL) continue;
      if (data.instanceId === this.instanceId) continue;
      if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65_535) continue;
      const updatedAt = Number(data.updatedAt ?? 0);
      if (!updatedAt || now - updatedAt > REGISTRY_STALE_MS) {
        if (updatedAt && now - updatedAt > 2 * REGISTRY_STALE_MS) {
          await fs.rm(file, { force: true }).catch(() => {});
        }
        continue;
      }
      if (this.config.requireSameAccount && data.accountScope !== this.account.scope) {
        this.mismatches.add(data.instanceId);
        continue;
      }
      this.considerPeer({
        id: data.instanceId,
        name: data.name,
        profile: data.profile,
        accountScope: data.accountScope,
        signedIn: data.signedIn,
        endpoint: { host: '127.0.0.1', port: data.port },
        source: 'local',
      });
    }
  }

  async writeRegistry() {
    if (this.stopped || !this.started || !this.config.local) return;
    const payload = {
      protocol: PROTOCOL,
      version: VERSION,
      instanceId: this.instanceId,
      name: this.name,
      profile: this.profileName,
      accountScope: this.account.scope,
      signedIn: this.account.signedIn,
      host: this.config.listenHost,
      port: this.port,
      pid: process.pid,
      hostname: os.hostname(),
      keyFingerprint: keyFingerprint(this.key),
      updatedAt: Date.now(),
    };
    const temp = `${this.registryFile}.${process.pid}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.registryFile), { recursive: true, mode: 0o700 });
      await fs.writeFile(temp, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
      try {
        await fs.rename(temp, this.registryFile);
      } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'EEXIST') {
          await fs.rm(this.registryFile, { force: true });
          await fs.rename(temp, this.registryFile);
        } else {
          throw error;
        }
      }
    } catch (error) {
      this.lastError = `registry write failed: ${truncate(error?.message ?? error, 160)}`;
    }
  }

  async startUdp() {
    try {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.udp = socket;
      socket.on('error', (error) => {
        this.lanError = truncate(error?.message ?? error, 200);
        this.emitChange();
      });
      socket.on('message', (buffer, rinfo) => {
        this.onUdpMessage(buffer, rinfo);
      });
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          socket.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          socket.off('error', onError);
          resolve();
        };
        socket.once('error', onError);
        socket.once('listening', onListening);
        socket.bind({
          port: this.config.udpPort || DEFAULT_UDP_PORT,
          address: '0.0.0.0',
          exclusive: false,
        });
      });
      try {
        socket.setMulticastTTL(1);
        socket.setMulticastLoopback(true);
      } catch {
        // Platform-specific; discovery still works on hosts that expose it.
      }
      const joined = new Set();
      for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses ?? []) {
          if (address.family !== 'IPv4' || address.internal || joined.has(address.address)) continue;
          joined.add(address.address);
          try {
            socket.addMembership(MULTICAST_GROUP, address.address);
          } catch {
            // A NIC may not support multicast; other interfaces still participate.
          }
        }
      }
      try {
        socket.addMembership(MULTICAST_GROUP);
      } catch {
        // Default-interface membership is best effort.
      }
      this.sendBeacon();
      this.udpTimer = setInterval(() => this.sendBeacon(), 5_000);
      this.udpTimer.unref?.();
    } catch (error) {
      this.lanError = truncate(error?.message ?? error, 200);
      if (this.udp) {
        try {
          this.udp.close();
        } catch {
          // already closed
        }
        this.udp = null;
      }
      this.emitChange();
    }
  }

  startRelay() {
    if (!this.config.relayUrl) {
      this.lastError = 'relay transport is enabled but relayUrl is empty';
      this.emitChange();
      return;
    }
    this.relay = new RelayClient({
      url: this.config.relayUrl,
      token: this.config.relayToken,
      key: this.key,
      node: this,
      instanceId: this.instanceId,
      name: this.name,
      profile: this.profileName,
      accountScope: this.account.scope,
      signedIn: this.account.signedIn,
      logger: this.logger,
    });
    this.relay.on('peers', (peers) => this.onRelayPeers(peers));
    this.relay.on('peer', (peer) => this.onRelayPeer(peer));
    this.relay.on('leave', (instanceId) => this.markPeerOffline(instanceId));
    this.relay.on('status', (status) => {
      if (status.error) this.lastError = status.error;
      this.emitChange();
    });
    this.relay.start();
  }

  onRelayPeers(peers) {
    const seen = new Set();
    for (const peer of peers) {
      if (!peer || typeof peer.instanceId !== 'string' || peer.instanceId === this.instanceId) continue;
      seen.add(peer.instanceId);
      this.onRelayPeer(peer);
    }
    for (const peer of this.peers.values()) {
      if (peer.source === 'relay' && !seen.has(peer.id)) this.markPeerOffline(peer.id);
    }
  }

  onRelayPeer(peer) {
    if (!peer || typeof peer.instanceId !== 'string' || peer.instanceId === this.instanceId) return;
    const known = this.peers.get(peer.instanceId);
    if (known) known.nextAttemptAt = 0;
    const considered = this.considerPeer({
      id: peer.instanceId,
      name: peer.name,
      profile: peer.profile,
      accountScope: peer.accountScope,
      signedIn: peer.signedIn,
      endpoint: null,
      source: 'relay',
    });
    if (considered && !considered.online && !considered.inflight) {
      void this.handshake(considered);
    }
  }

  markPeerOffline(instanceId) {
    const peer = this.peers.get(instanceId);
    if (!peer || peer.source !== 'relay') return;
    if (!peer.online) return;
    peer.online = false;
    peer.lastSeen = Date.now();
    this.persistPeer(peer);
    this.emitChange();
  }

  sendBeacon() {
    if (!this.udp || this.stopped) return;
    const beacon = Buffer.from(JSON.stringify({
      type: 'announce',
      protocol: PROTOCOL,
      version: VERSION,
      instanceId: this.instanceId,
      name: this.name,
      profile: this.profileName,
      accountScope: this.account.scope,
      signedIn: this.account.signedIn,
      port: this.port,
      keyFingerprint: keyFingerprint(this.key),
    }));
    try {
      this.udp.send(beacon, this.config.udpPort || DEFAULT_UDP_PORT, MULTICAST_GROUP, () => {});
    } catch {
      // UDP is advisory; the registry and manual peers remain available.
    }
  }

  onUdpMessage(buffer, rinfo) {
    let data;
    try {
      data = JSON.parse(buffer.toString('utf8'));
    } catch {
      return;
    }
    if (!data || data.type !== 'announce' || data.protocol !== PROTOCOL) return;
    if (data.instanceId === this.instanceId) return;
    if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65_535) return;
    if (this.config.requireSameAccount && data.accountScope !== this.account.scope) {
      this.mismatches.add(data.instanceId);
      return;
    }
    this.considerPeer({
      id: data.instanceId,
      name: data.name,
      profile: data.profile,
      accountScope: data.accountScope,
      signedIn: data.signedIn,
      endpoint: { host: normalizeRemoteAddress(rinfo.address), port: data.port },
      source: 'lan',
    });
  }

  async probeManualPeers() {
    if (this.stopped || !this.config.manual || this.config.manualPeers.length === 0) return;
    if (Date.now() - this.lastManualProbe < MANUAL_PROBE_INTERVAL_MS) return;
    this.lastManualProbe = Date.now();
    for (const raw of this.config.manualPeers) {
      let url;
      try {
        url = new URL(raw);
      } catch {
        this.manualError = `invalid manual peer URL: ${raw}`;
        continue;
      }
      if (url.protocol !== 'http:') {
        this.manualError = `manual peer must use http://: ${raw}`;
        continue;
      }
      const port = Number(url.port || 80);
      try {
        const nonce = randomNonce();
        const response = await fetchJson(`${url.origin}/v1/hello?nonce=${nonce}`, { timeout: 3_500 });
        if (response.protocol !== PROTOCOL) throw new Error('protocol mismatch');
        if (!verifyHelloProof(this.key, nonce, response.instanceId, response.proof)) {
          throw new Error('pairing key does not match');
        }
        if (this.config.requireSameAccount
          && response.accountScope
          && response.accountScope !== this.account.scope) {
          throw new Error('different account');
        }
        this.manualError = null;
        this.considerPeer({
          id: response.instanceId,
          name: response.name,
          profile: response.profile,
          accountScope: response.accountScope,
          signedIn: response.signedIn,
          endpoint: { host: url.hostname, port },
          source: 'manual',
        });
      } catch (error) {
        this.manualError = `${raw}: ${truncate(error?.message ?? error, 160)}`;
      }
    }
    this.emitChange();
  }

  async handleRequest(req, res) {
    const url = new URL(req.url ?? '/', 'http://peer-link.invalid');
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      sendJson(res, 200, { ok: true, protocol: PROTOCOL, instanceId: this.instanceId });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/hello') {
      await this.handleHello(req, res, url);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/message') {
      await this.handleMessage(req, res);
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not found' });
  }

  async handleHello(req, res, url) {
    const remote = normalizeRemoteAddress(req.socket.remoteAddress);
    if (!this.allowRate(`hello:${remote}`, 90)) {
      sendJson(res, 429, { ok: false, error: 'too many requests' });
      return;
    }
    const nonce = url.searchParams.get('nonce') ?? '';
    if (!/^[0-9a-f]{8,128}$/i.test(nonce)) {
      sendJson(res, 400, { ok: false, error: 'nonce is required' });
      return;
    }
    sendJson(res, 200, {
      protocol: PROTOCOL,
      version: VERSION,
      instanceId: this.instanceId,
      name: this.name,
      profile: this.profileName,
      accountScope: this.account.scope,
      signedIn: this.account.signedIn,
      port: this.port,
      pid: process.pid,
      hostname: os.hostname(),
      keyFingerprint: keyFingerprint(this.key),
      proof: helloProof(this.key, nonce, this.instanceId),
    });
  }

  async handleMessage(req, res) {
    const remote = normalizeRemoteAddress(req.socket.remoteAddress);
    if (!this.allowRate(`message:${remote}`, 240)) {
      sendJson(res, 429, { ok: false, error: 'too many requests' });
      return;
    }
    let body;
    try {
      body = await readBody(req, MAX_BODY_BYTES);
    } catch (error) {
      sendJson(res, error?.status ?? 400, { ok: false, error: truncate(error?.message ?? error, 160) });
      return;
    }
    const timestamp = Number(req.headers['x-peer-timestamp']);
    const nonce = String(req.headers['x-peer-nonce'] ?? '');
    const signature = String(req.headers['x-peer-signature'] ?? '');
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > CLOCK_SKEW_MS) {
      sendJson(res, 401, { ok: false, error: 'stale request' });
      return;
    }
    if (!/^[0-9a-f]{16,64}$/i.test(nonce)) {
      sendJson(res, 401, { ok: false, error: 'invalid nonce' });
      return;
    }
    if (this.nonces.has(nonce)) {
      sendJson(res, 409, { ok: false, error: 'replayed request' });
      return;
    }
    if (!verifyRequest(this.key, 'POST', '/v1/message', timestamp, nonce, body, signature)) {
      this.lastError = `rejected message from ${remote}: bad signature`;
      sendJson(res, 401, { ok: false, error: 'invalid signature' });
      return;
    }
    this.nonces.set(nonce, Date.now() + CLOCK_SKEW_MS + 60_000);

    let payload;
    try {
      payload = decryptBody(this.key, JSON.parse(body), encryptionAad('POST', '/v1/message', timestamp, nonce));
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid encrypted payload' });
      return;
    }
    if (!payload || typeof payload !== 'object' || payload.to !== this.instanceId) {
      sendJson(res, 400, { ok: false, error: 'message is not addressed to this instance' });
      return;
    }
    const fromPort = Number(payload.from?.port);
    if (!Number.isInteger(fromPort) || fromPort < 1 || fromPort > 65_535) {
      sendJson(res, 400, { ok: false, error: 'sender did not advertise its peer port' });
      return;
    }
    const accepted = this.acceptInbound(payload, {
      source: 'inbound',
      endpoint: { host: remote, port: fromPort },
    });
    if (!accepted.ok) {
      sendJson(res, accepted.status ?? 400, { ok: false, error: accepted.error });
      return;
    }
    sendJson(res, 200, { ok: true, id: payload.id, receivedAt: accepted.at, duplicate: accepted.duplicate === true });
  }

  /**
   * Validate and store one already-authenticated peer payload. Both the direct
   * HTTP transport and the optional relay call this, so message semantics,
   * account checks, and deduplication cannot drift between transports.
   */
  acceptInbound(payload, options = {}) {
    try {
      if (!payload || typeof payload !== 'object' || payload.to !== this.instanceId) {
        return { ok: false, status: 400, error: 'message is not addressed to this instance' };
      }
      if (typeof payload.id !== 'string' || !/^[0-9a-zA-Z_-]{8,80}$/.test(payload.id)) {
        return { ok: false, status: 400, error: 'invalid message id' };
      }
      const text = typeof payload.text === 'string' ? payload.text.slice(0, DEFAULT_MAX_TEXT) : '';
      if (!text) return { ok: false, status: 400, error: 'empty message' };
      const from = payload.from;
      if (!from || typeof from !== 'object' || typeof from.instanceId !== 'string' || from.instanceId.length < 8) {
        return { ok: false, status: 400, error: 'invalid sender' };
      }
      if (this.config.requireSameAccount && from.accountScope !== this.account.scope) {
        return { ok: false, status: 403, error: 'sender is signed in to a different account' };
      }
      if (this.store.hasMessage(payload.id)) {
        return { ok: true, id: payload.id, duplicate: true, at: Date.now() };
      }

      const peer = this.considerPeer({
        id: from.instanceId,
        name: from.name,
        profile: from.profile,
        accountScope: from.accountScope,
        signedIn: from.signedIn,
        endpoint: options.endpoint ?? null,
        source: options.source ?? 'inbound',
      });
      if (peer) {
        peer.online = true;
        peer.keyMatch = true;
        peer.lastSeen = Date.now();
        peer.lastError = null;
        this.persistPeer(peer);
      }

      const at = Date.now();
      const stored = {
        id: payload.id,
        dir: 'in',
        text,
        at,
        remoteAt: Number.isFinite(Number(payload.sentAt)) ? Number(payload.sentAt) : null,
        status: 'received',
        fromName: typeof from.name === 'string' ? from.name.slice(0, 80) : '',
        auto: payload.auto === true,
      };
      this.store.addMessage(from.instanceId, stored);
      this.emit('inbound', {
        peerId: from.instanceId,
        message: { ...stored },
        peer: peer ? { id: peer.id, name: peerDisplayName(peer), online: peer.online } : null,
      });
      this.emitChange();
      return { ok: true, id: payload.id, at };
    } catch (error) {
      return { ok: false, status: 400, error: truncate(error?.message ?? String(error), 200) };
    }
  }

  allowRate(key, limit) {
    const now = Date.now();
    let entry = this.rate.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 60_000 };
      this.rate.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  cleanupReplay() {
    const now = Date.now();
    for (const [nonce, expiry] of this.nonces) if (expiry <= now) this.nonces.delete(nonce);
    for (const [key, entry] of this.rate) if (entry.resetAt <= now) this.rate.delete(key);
  }

  endpointOrigin(endpoint) {
    return `http://${formatHost(endpoint.host)}:${endpoint.port}`;
  }

  emitChange() {
    if (this.stopped || this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      if (!this.stopped) this.emit('change');
    }, 40);
    this.changeTimer.unref?.();
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
    for (const timer of [this.heartbeatTimer, this.scanTimer, this.maintenanceTimer, this.udpTimer]) {
      if (timer) clearInterval(timer);
    }
    this.heartbeatTimer = null;
    this.scanTimer = null;
    this.maintenanceTimer = null;
    this.udpTimer = null;
    if (this.udp) {
      try {
        this.udp.close();
      } catch {
        // already closed
      }
      this.udp = null;
    }
    if (this.relay) {
      const relay = this.relay;
      this.relay = null;
      relay.stop();
    }
    await fs.rm(this.registryFile, { force: true }).catch(() => {});
    if (this.server) {
      const server = this.server;
      this.server = null;
      server.closeAllConnections?.();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1_500);
        timer.unref?.();
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await this.store.flush();
    this.emit('stopped');
  }
}

function normalizeAccount(account) {
  const signedIn = account?.signedIn === true;
  return {
    signedIn,
    scope: typeof account?.scope === 'string' && account.scope ? account.scope : 'local:unknown',
    label: typeof account?.label === 'string' && account.label ? account.label : (signedIn ? 'DeepSeek account' : 'Local account'),
  };
}

function normalizeEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'object') return null;
  const host = typeof endpoint.host === 'string' ? endpoint.host.trim() : '';
  const port = Number(endpoint.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host, port };
}

function peerDisplayName(peer) {
  return peer.name || peer.id.slice(0, 8);
}

function lanAddresses() {
  const result = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) result.push({ address: address.address, netmask: address.netmask });
    }
  }
  return result;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(options.timeout ?? 3_500),
    redirect: 'error',
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`peer returned a non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok || json?.ok === false) {
    const error = new Error(json?.error || `peer returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return json;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('request body is too large');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  if (res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
