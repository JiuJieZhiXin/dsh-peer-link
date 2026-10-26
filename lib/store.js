/**
 * Durable Peer Link message store.
 *
 * One JSON file per Host instance keeps the implementation dependency-free and
 * easy to inspect. Writes are debounced and atomic (temp file + rename), and a
 * failed write never takes the live messaging path down with it.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({
  version: 1,
  peers: {},
  conversations: {},
  reads: {},
});

export class MessageStore {
  constructor(file, options = {}) {
    this.file = file;
    this.maxMessages = Number.isInteger(options.maxMessages) && options.maxMessages > 0
      ? Math.min(options.maxMessages, 2000)
      : 300;
    this.logger = options.logger ?? console;
    this.data = EMPTY();
    this.messageIds = new Set();
    this.saveTimer = null;
    this.saveChain = Promise.resolve();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid store');
      this.data = {
        version: 1,
        peers: isRecord(parsed.peers) ? parsed.peers : {},
        conversations: isRecord(parsed.conversations) ? parsed.conversations : {},
        reads: isRecord(parsed.reads) ? parsed.reads : {},
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn?.(`[peer-link] could not read message store: ${error?.message ?? error}`);
      }
      this.data = EMPTY();
    }
    for (const [peerId, conversation] of Object.entries(this.data.conversations)) {
      if (!conversation || !Array.isArray(conversation.messages)) {
        delete this.data.conversations[peerId];
        continue;
      }
      conversation.messages = conversation.messages
        .filter((message) => message && typeof message.id === 'string' && typeof message.text === 'string')
        .slice(-this.maxMessages);
      for (const message of conversation.messages) this.messageIds.add(message.id);
    }
    for (const [peerId, peer] of Object.entries(this.data.peers)) {
      if (!peer || typeof peer !== 'object' || peer.id !== peerId) delete this.data.peers[peerId];
    }
    return this;
  }

  getPeer(peerId) {
    return this.data.peers[peerId];
  }

  listPeers() {
    return Object.values(this.data.peers);
  }

  upsertPeer(peerId, patch) {
    const current = this.data.peers[peerId] ?? { id: peerId };
    const next = { ...current, ...patch, id: peerId };
    this.data.peers[peerId] = next;
    this.scheduleSave();
    return next;
  }

  hasMessage(messageId) {
    return this.messageIds.has(messageId);
  }

  addMessage(peerId, message) {
    if (this.messageIds.has(message.id)) return { duplicate: true, message: null };
    const conversation = this.conversation(peerId);
    conversation.messages.push(message);
    if (conversation.messages.length > this.maxMessages) {
      const removed = conversation.messages.splice(0, conversation.messages.length - this.maxMessages);
      for (const item of removed) this.messageIds.delete(item.id);
    }
    this.messageIds.add(message.id);
    this.scheduleSave();
    return { duplicate: false, message };
  }

  updateMessage(peerId, messageId, patch) {
    const conversation = this.data.conversations[peerId];
    if (!conversation) return null;
    const message = conversation.messages.find((item) => item.id === messageId);
    if (!message) return null;
    Object.assign(message, patch);
    this.scheduleSave();
    return message;
  }

  listMessages(peerId, limit = this.maxMessages) {
    const messages = this.data.conversations[peerId]?.messages ?? [];
    return limit > 0 ? messages.slice(-limit) : [...messages];
  }

  removePeer(peerId) {
    const conversation = this.data.conversations[peerId];
    const had = Boolean(this.data.peers[peerId] || conversation || this.data.reads[peerId]);
    if (conversation) {
      for (const message of conversation.messages ?? []) this.messageIds.delete(message.id);
    }
    delete this.data.peers[peerId];
    delete this.data.conversations[peerId];
    delete this.data.reads[peerId];
    if (had) this.scheduleSave();
    return had;
  }

  lastMessage(peerId) {
    const messages = this.data.conversations[peerId]?.messages ?? [];
    return messages.length > 0 ? messages[messages.length - 1] : null;
  }

  unread(peerId) {
    const readAt = Number(this.data.reads[peerId] ?? 0);
    return (this.data.conversations[peerId]?.messages ?? [])
      .filter((message) => message.dir === 'in' && Number(message.at) > readAt)
      .length;
  }

  totalUnread() {
    return Object.keys(this.data.conversations).reduce((total, peerId) => total + this.unread(peerId), 0);
  }

  markRead(peerId, at = Date.now()) {
    this.data.reads[peerId] = at;
    this.scheduleSave();
  }

  conversation(peerId) {
    let conversation = this.data.conversations[peerId];
    if (!conversation) {
      conversation = { peerId, messages: [] };
      this.data.conversations[peerId] = conversation;
    }
    return conversation;
  }

  scheduleSave(delay = 180) {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, delay);
    this.saveTimer.unref?.();
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveChain = this.saveChain.then(() => this.write()).catch((error) => {
      this.logger.warn?.(`[peer-link] could not write message store: ${error?.message ?? error}`);
    });
    return this.saveChain;
  }

  async write() {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, this.file);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
