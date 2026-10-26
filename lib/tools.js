/**
 * Model-facing Peer Link tools.
 *
 * Kept separate from the Host glue so the tool schemas are easy to audit and
 * the service can register them on whichever Tool registry context is active.
 */
import { truncate } from './protocol.js';

const PEER_LIST_PARAMETERS = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const SEND_PARAMETERS = {
  type: 'object',
  properties: {
    peer: {
      type: 'string',
      description: 'Peer id, unique id prefix, or display name from peer_link_list.',
    },
    text: {
      type: 'string',
      description: 'Message text (1-8000 characters). Plain text only.',
    },
  },
  required: ['peer', 'text'],
  additionalProperties: false,
};

const INBOX_PARAMETERS = {
  type: 'object',
  properties: {
    peer: {
      type: 'string',
      description: 'Optional peer id, id prefix, or display name. Omit to read every conversation.',
    },
    limit: {
      type: 'integer',
      description: 'Maximum messages per peer (1-100, default 20).',
    },
    markRead: {
      type: 'boolean',
      description: 'Mark the read messages as read (default true).',
    },
  },
  additionalProperties: false,
};

const PEER_LIST_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    self: { type: 'object', additionalProperties: true },
    peers: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};

const SEND_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    delivered: { type: 'boolean' },
    peer: { type: 'object', additionalProperties: true },
    message: { type: 'object', additionalProperties: true },
    error: { type: 'string' },
  },
};

const INBOX_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    messages: { type: 'array', items: { type: 'object', additionalProperties: true } },
    unread: { type: 'number' },
    error: { type: 'string' },
  },
};

export function registerPeerTools(service, tools) {
  const disposers = [];

  disposers.push(registerTool(tools, {
    name: 'peer_link_list',
    description:
      'List other DeepSeek Harness instances reachable through Peer Link. Only instances signed in to the same DeepSeek account (and, across machines, sharing the same pairing key) appear. Use this before peer_link_send or peer_link_inbox.',
    parameters: PEER_LIST_PARAMETERS,
    output: {
      schema: PEER_LIST_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderPeerList(value) }],
    },
    timeoutMs: 8_000,
    isConcurrencySafe: () => true,
    async execute() {
      await service.ensureReady();
      const state = service.node.getState();
      return {
        ok: true,
        self: state.self,
        peers: state.peers.map((peer) => ({
          id: peer.id,
          name: peer.name,
          online: peer.online,
          keyMatch: peer.keyMatch,
          signedIn: peer.signedIn,
          unread: peer.unread,
          lastSeen: peer.lastSeen,
          source: peer.source,
          lastMessage: peer.lastMessage,
        })),
      };
    },
    presentCall: () => ({ card: 'generic', title: 'List Peer Link peers', kind: 'other' }),
  }));

  disposers.push(registerTool(tools, {
    name: 'peer_link_send',
    description:
      'Send a chat message to another DeepSeek Harness instance over Peer Link. The message is visible to the human on that instance in their Peer Link panel; it is not a command channel and must not be used to request unsafe actions. Call peer_link_list first when the target is unclear.',
    parameters: SEND_PARAMETERS,
    output: {
      schema: SEND_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value?.ok
          ? `Peer Link message ${value.delivered ? 'delivered' : 'queued'} for ${value.peer?.name ?? 'peer'}.`
          : `Peer Link send failed: ${value?.error ?? 'unknown error'}`,
      }],
    },
    timeoutMs: 15_000,
    async execute(args, exec) {
      try {
        await service.ensureReady();
        return await service.sendPeer(args.peer, args.text, exec?.agent);
      } catch (error) {
        return { ok: false, delivered: false, error: truncate(error?.message ?? String(error), 300) };
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Send Peer Link message',
      kind: 'other',
      rawInput: args,
    }),
  }));

  disposers.push(registerTool(tools, {
    name: 'peer_link_inbox',
    description:
      'Read recent messages received over Peer Link, optionally only from one peer. By default reading marks those messages as read. Use peer_link_list if you need peer ids or online state first.',
    parameters: INBOX_PARAMETERS,
    output: {
      schema: INBOX_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderInbox(value) }],
    },
    timeoutMs: 8_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      try {
        await service.ensureReady();
        const node = service.node;
        const state = node.getState();
        const summaries = args.peer
          ? [state.peers.find((peer) => peer.id === node.resolvePeer(args.peer).id)].filter(Boolean)
          : state.peers;
        const limit = Math.min(Math.max(Number.isInteger(args.limit) ? args.limit : 20, 1), 100);
        const messages = [];
        for (const peer of summaries) {
          for (const message of node.store.listMessages(peer.id, limit)) {
            messages.push({
              id: message.id,
              peerId: peer.id,
              peerName: peer.name,
              dir: message.dir,
              text: message.text,
              at: message.at,
              status: message.status,
            });
          }
          if (args.markRead !== false) node.markRead(peer.id);
        }
        messages.sort((left, right) => left.at - right.at);
        return { ok: true, messages, unread: node.store.totalUnread() };
      } catch (error) {
        return { ok: false, messages: [], error: truncate(error?.message ?? String(error), 300) };
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Read Peer Link inbox', kind: 'other' }),
  }));

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // The owning Tool registry is already gone.
      }
    }
  };
}

const ALLOWED_SCHEMA_KEYS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'description', 'title', 'default', 'examples',
]);
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/**
 * Register one tool only after its public schemas fit the Host's enforced JSON
 * Schema subset. A bad schema normally registers and then breaks every model
 * request in the session, so fail the activation instead.
 */
function registerTool(tools, definition) {
  assertObjectSchema(definition.parameters, `${definition.name}.parameters`);
  if (definition.output?.schema) {
    assertSchema(definition.output.schema, `${definition.name}.output.schema`);
  }
  return tools.register(definition);
}

function assertObjectSchema(node, path) {
  assertSchema(node, path);
  if (node.type !== 'object') throw new Error(`${path} must have type "object"`);
}

function assertSchema(node, path) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`${path} must be a JSON Schema object`);
  }
  for (const key of Object.keys(node)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) {
      throw new Error(`${path}.${key} is outside the supported JSON Schema subset`);
    }
  }
  if (node.type !== undefined) {
    if (!SCHEMA_TYPES.has(node.type)) throw new Error(`${path}.type is invalid`);
    if (node.type !== 'object') {
      if (node.properties || node.required || node.additionalProperties !== undefined) {
        throw new Error(`${path} has object keywords on type "${node.type}"`);
      }
      if (node.type !== 'array' && node.items !== undefined) {
        throw new Error(`${path}.items is only valid on arrays`);
      }
    }
  }
  if (node.properties !== undefined) {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      throw new Error(`${path}.properties must be an object of schemas`);
    }
    for (const [key, child] of Object.entries(node.properties)) {
      assertSchema(child, `${path}.properties.${key}`);
    }
  }
  if (node.required !== undefined) {
    if (!Array.isArray(node.required) || node.required.some((key) => typeof key !== 'string')) {
      throw new Error(`${path}.required must be an array of strings`);
    }
  }
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') {
    throw new Error(`${path}.additionalProperties must be a boolean`);
  }
  if (node.items !== undefined) assertSchema(node.items, `${path}.items`);
  if (node.oneOf !== undefined) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) throw new Error(`${path}.oneOf must list at least two schemas`);
    node.oneOf.forEach((child, index) => assertSchema(child, `${path}.oneOf[${index}]`));
  }
}

function renderPeerList(value) {  if (!value || value.ok !== true) return `Peer Link error: ${value?.error ?? 'unknown error'}`;
  const peers = Array.isArray(value.peers) ? value.peers : [];
  if (peers.length === 0) {
    return `No Peer Link peers yet. This instance is "${value.self?.name ?? 'unknown'}"; install Peer Link and sign in to the same account on another instance.`;
  }
  const lines = peers.map((peer) => {
    const status = peer.online ? (peer.keyMatch === false ? 'key mismatch' : 'online') : 'offline';
    const unread = peer.unread ? `, ${peer.unread} unread` : '';
    const source = peer.source ? `, ${peer.source}` : '';
    return `- ${peer.name} (${String(peer.id).slice(0, 8)}) — ${status}${unread}${source}`;
  });
  return `Peer Link peers for "${value.self?.name ?? 'this instance'}":\n${lines.join('\n')}`;
}

function renderInbox(value) {
  if (!value || value.ok !== true) return `Peer Link error: ${value?.error ?? 'unknown error'}`;
  const messages = Array.isArray(value.messages) ? value.messages : [];
  if (messages.length === 0) return 'No Peer Link messages.';
  const lines = messages.map((message) => {
    const when = new Date(message.at).toISOString();
    const direction = message.dir === 'out' ? 'sent' : 'received';
    return `[${when}] ${direction} ${message.peerName}: ${message.text}`;
  });
  return `Peer Link messages (${value.unread ?? 0} unread):\n${lines.join('\n')}`;
}
