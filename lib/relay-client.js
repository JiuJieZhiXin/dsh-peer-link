/**
 * Optional WebSocket relay client.
 *
 * The relay is a dumb, authenticated pipe: it never receives the pairing key,
 * and every payload is encrypted and signed with the same cluster key the
 * direct transports use. A relay therefore cannot read or forge messages.
 */
import { EventEmitter } from 'node:events';
import {
  PROTOCOL,
  VERSION,
  decryptBody,
  encryptBody,
  helloProof,
  randomNonce,
  relayAad,
  signRelayMessage,
  truncate,
  verifyHelloProof,
  verifyRelayMessage,
} from './protocol.js';

export class RelayClient extends EventEmitter {
  constructor(options) {
    super();
    this.url = options.url;
    this.token = options.token ?? '';
    this.key = options.key;
    this.node = options.node;
    this.logger = options.logger ?? console;
    this.instanceId = options.instanceId;
    this.descriptor = {
      instanceId: options.instanceId,
      name: options.name,
      profile: options.profile ?? '',
      version: VERSION,
      protocol: PROTOCOL,
      accountScope: options.accountScope,
      signedIn: options.signedIn === true,
    };
    this.socket = null;
    this.stopped = false;
    this.connected = false;
    this.registered = false;
    this.error = null;
    this.attempt = 0;
    this.lastPong = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pendingHello = new Map();
    this.pendingSend = new Map();
  }

  start() {
    if (this.stopped) return;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.connected = false;
    this.registered = false;
    this.rejectPending(new Error('relay client stopped'));
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
  }

  connect() {
    if (this.stopped || this.socket) return;
    const WebSocketImpl = globalThis.WebSocket;
    if (typeof WebSocketImpl !== 'function') {
      this.error = 'this runtime does not provide WebSocket';
      this.emitStatus();
      return;
    }
    let target;
    try {
      target = new URL(this.url);
      if (!['ws:', 'wss:'].includes(target.protocol)) throw new Error('relayUrl must start with ws:// or wss://');
      if (this.token) target.searchParams.set('token', this.token);
      target.searchParams.set('account', this.descriptor.accountScope);
      target.searchParams.set('instance', this.instanceId);
    } catch (error) {
      this.error = truncate(error?.message ?? String(error), 240);
      this.emitStatus();
      return;
    }

    let socket;
    try {
      socket = new WebSocketImpl(target.toString());
    } catch (error) {
      this.error = truncate(error?.message ?? String(error), 240);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.stopped || this.socket !== socket) return;
      this.connected = true;
      this.attempt = 0;
      this.lastPong = Date.now();
      this.error = null;
      this.send({
        type: 'register',
        protocol: PROTOCOL,
        instanceId: this.instanceId,
        name: this.descriptor.name,
        profile: this.descriptor.profile,
        accountScope: this.descriptor.accountScope,
        signedIn: this.descriptor.signedIn,
      });
      this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
      this.heartbeatTimer.unref?.();
      this.emitStatus();
    });
    socket.addEventListener('message', (event) => {
      if (this.stopped || this.socket !== socket) return;
      this.handleMessage(event.data);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.registered = false;
      this.socket = null;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.rejectPending(new Error('relay connection closed'));
      this.emitStatus();
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) {
        this.error = 'relay connection failed';
        this.emitStatus();
      }
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_500 * 2 ** Math.min(this.attempt, 5));
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  heartbeat() {
    if (!this.connected) return;
    if (Date.now() - this.lastPong > 90_000) {
      this.error = 'relay heartbeat timed out';
      try {
        this.socket?.close();
      } catch {
        // already closed
      }
      return;
    }
    this.send({ type: 'ping' });
  }

  send(frame) {
    if (!this.socket || !this.connected) return false;
    try {
      this.socket.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      this.error = truncate(error?.message ?? String(error), 200);
      return false;
    }
  }

  async hello(peer, timeoutMs = 6_000) {
    if (!this.connected || !this.registered) throw new Error('relay is not connected');
    const nonce = randomNonce();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHello.delete(nonce);
        reject(new Error('peer did not answer over the relay'));
      }, timeoutMs);
      timer.unref?.();
      this.pendingHello.set(nonce, { peerId: peer.id, resolve, reject, timer });
      if (!this.send({ type: 'hello', to: peer.id, nonce })) {
        clearTimeout(timer);
        this.pendingHello.delete(nonce);
        reject(new Error('relay is not connected'));
      }
    });
  }

  async sendMessage(peer, message) {
    if (!this.connected || !this.registered) throw new Error('relay is not connected');
    const timestamp = Date.now();
    const nonce = randomNonce();
    const aad = relayAad(message.id, this.instanceId, peer.id, timestamp, nonce);
    const payload = {
      id: message.id,
      text: message.text,
      sentAt: message.at,
      auto: message.auto === true,
      from: this.descriptor,
      to: peer.id,
    };
    const body = JSON.stringify(encryptBody(this.key, payload, aad));
    const signature = signRelayMessage(this.key, message.id, this.instanceId, peer.id, timestamp, nonce, body);
    const frame = {
      type: 'message',
      to: peer.id,
      id: message.id,
      ts: timestamp,
      nonce,
      body,
      sig: signature,
      from: this.descriptor,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSend.delete(message.id);
        reject(new Error('relay did not acknowledge the message'));
      }, 8_000);
      timer.unref?.();
      this.pendingSend.set(message.id, { resolve, reject, timer });
      if (!this.send(frame)) {
        clearTimeout(timer);
        this.pendingSend.delete(message.id);
        reject(new Error('relay is not connected'));
      }
    });
  }

  handleMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    switch (frame.type) {
      case 'registered':
        this.registered = true;
        this.lastPong = Date.now();
        this.error = null;
        this.emit('peers', Array.isArray(frame.peers) ? frame.peers : []);
        this.emitStatus();
        this.emit('ready');
        break;
      case 'peers':
        this.emit('peers', Array.isArray(frame.peers) ? frame.peers : []);
        break;
      case 'join':
        if (frame.peer) this.emit('peer', frame.peer);
        break;
      case 'leave':
        if (typeof frame.instanceId === 'string') this.emit('leave', frame.instanceId);
        break;
      case 'hello':
        this.answerHello(frame);
        break;
      case 'hello-ack':
        this.resolveHello(frame);
        break;
      case 'deliver':
        this.receiveMessage(frame);
        break;
      case 'ack':
        this.resolveSend(frame);
        break;
      case 'pong':
        this.lastPong = Date.now();
        break;
      case 'error':
        this.handleRelayError(frame);
        break;
      default:
        break;
    }
  }

  answerHello(frame) {
    if (typeof frame.from !== 'string' || typeof frame.nonce !== 'string') return;
    this.send({
      type: 'hello-ack',
      to: frame.from,
      nonce: frame.nonce,
      descriptor: this.descriptor,
      proof: helloProof(this.key, frame.nonce, this.instanceId),
    });
  }

  resolveHello(frame) {
    const pending = this.pendingHello.get(frame.nonce);
    if (!pending) return;
    this.pendingHello.delete(frame.nonce);
    clearTimeout(pending.timer);
    const descriptor = frame.descriptor;
    if (!descriptor || descriptor.instanceId !== pending.peerId) {
      pending.reject(new Error('relay peer identity mismatch'));
      return;
    }
    if (!verifyHelloProof(this.key, frame.nonce, descriptor.instanceId, frame.proof)) {
      pending.reject(Object.assign(new Error('pairing key does not match this instance'), { code: 'KEY_MISMATCH' }));
      return;
    }
    pending.resolve(descriptor);
  }

  receiveMessage(frame) {
    try {
      if (typeof frame.id !== 'string' || typeof frame.body !== 'string' || typeof frame.from !== 'object') {
        throw new Error('malformed relay message');
      }
      if (frame.to !== this.instanceId) throw new Error('relay message is addressed to another instance');
      if (frame.from.accountScope !== this.descriptor.accountScope) {
        throw new Error('relay sender is signed in to a different account');
      }
      if (!verifyRelayMessage(
        this.key,
        frame.id,
        frame.from.instanceId,
        frame.to,
        Number(frame.ts),
        String(frame.nonce),
        frame.body,
        frame.sig,
      )) {
        throw new Error('relay message signature is invalid');
      }
      const payload = decryptBody(
        this.key,
        JSON.parse(frame.body),
        relayAad(frame.id, frame.from.instanceId, frame.to, Number(frame.ts), String(frame.nonce)),
      );
      if (payload.to !== this.instanceId) throw new Error('relay payload is addressed to another instance');
      this.node.acceptInbound(payload, { source: 'relay', endpoint: null, remote: 'relay' });
    } catch (error) {
      this.logger.warn?.(`[peer-link] relay message rejected: ${error?.message ?? error}`);
    }
  }

  resolveSend(frame) {
    const pending = this.pendingSend.get(frame.id);
    if (!pending) return;
    this.pendingSend.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.status === 'delivered' || frame.status === 'queued') {
      pending.resolve({ status: frame.status, at: Date.now() });
    } else {
      pending.reject(new Error(frame.error || 'relay rejected the message'));
    }
  }

  handleRelayError(frame) {
    const message = typeof frame.error === 'string' ? frame.error : 'relay error';
    if (typeof frame.ref === 'string' && this.pendingSend.has(frame.ref)) {
      const pending = this.pendingSend.get(frame.ref);
      this.pendingSend.delete(frame.ref);
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      return;
    }
    if (typeof frame.ref === 'string' && this.pendingHello.has(frame.ref)) {
      const pending = this.pendingHello.get(frame.ref);
      this.pendingHello.delete(frame.ref);
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      return;
    }
    this.error = truncate(message, 240);
    this.emitStatus();
  }

  rejectPending(error) {
    for (const pending of this.pendingHello.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingHello.clear();
    for (const pending of this.pendingSend.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingSend.clear();
  }

  emitStatus() {
    this.emit('status', {
      connected: this.connected,
      registered: this.registered,
      error: this.error,
    });
  }
}
