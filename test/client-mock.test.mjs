import assert from 'node:assert/strict';
import test from 'node:test';

const snapshot = {
  ready: true,
  status: 'ready',
  self: {
    instanceId: 'aaaaaaaaaaaaaaaa',
    name: 'Test Host',
    profile: 'desktop',
    account: { signedIn: true, label: 'DeepSeek · 1234' },
    port: 32123,
    endpoint: 'http://127.0.0.1:32123',
    lan: false,
    lanAddresses: [],
    keyFingerprint: '0123456789abcdef',
    transports: ['local', 'relay'],
    relay: { enabled: true, connected: true, error: null },
    startedAt: Date.now(),
  },
  peers: [{
    id: 'bbbbbbbbbbbbbbbb',
    name: 'Other Host',
    profile: 'desktop',
    online: true,
    keyMatch: true,
    signedIn: true,
    source: 'local',
    lastSeen: Date.now(),
    unread: 1,
    messageCount: 1,
    lastMessage: { text: 'hi there', at: Date.now(), dir: 'in', status: 'received' },
  }],
  conversations: {
    bbbbbbbbbbbbbbbb: [{ id: 'm1', dir: 'in', text: 'hello from peer', at: Date.now(), status: 'received' }],
  },
  stats: { online: 1, known: 1, unread: 1, mismatched: 0 },
  errors: { lan: null, manual: null, last: null },
  presets: { manualPeers: [], listenPort: 0, lan: false, requireSameAccount: true },
};

const hooks = { states: [], index: 0 };
function resetHooks() {
  hooks.states = [];
  hooks.index = 0;
}
function nextHook(initial) {
  const index = hooks.index++;
  if (!(index in hooks.states)) hooks.states[index] = initial;
  return { index, value: hooks.states[index] };
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.flat(Infinity) } };
  },
  useState(initial) {
    const slot = nextHook(typeof initial === 'function' ? initial() : initial);
    return [slot.value, (next) => {
      hooks.states[slot.index] = typeof next === 'function' ? next(hooks.states[slot.index]) : next;
    }];
  },
  useEffect() {
    hooks.index += 1;
  },
  useRef(initial) {
    return nextHook({ current: initial }).value;
  },
  useCallback(fn) {
    hooks.index += 1;
    return fn;
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    hooks.index += 1;
    return getSnapshot();
  },
};

function collectText(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object' && node.props) collectText(node.props.children, out);
  return out;
}

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    setTimeout(() => this.onopen?.(), 0);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  close() {}
}

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      globalThis.__peerLinkDefinition = definition;
    },
  },
};
globalThis.__DSH_PEER_LINK__ = { token: 'test-token' };
let lastSendBody = null;
globalThis.EventSource = FakeEventSource;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  if (path.endsWith('/state')) return response(snapshot);
  if (path.endsWith('/send')) {
    lastSendBody = JSON.parse(options.body);
    return response({ ok: true, result: { ok: true } });
  }
  if (path.endsWith('/read')) return response({ ok: true });
  if (path.endsWith('/refresh')) return response({ ok: true });
  if (path.endsWith('/identity')) return response({ ok: true, shareText: 'share' });
  return response({ ok: false, error: `unexpected ${path} ${options.method ?? 'GET'}` }, 404);
};
const styleNodes = [];
globalThis.document = {
  head: {
    appendChild(node) {
      styleNodes.push(node);
    },
  },
  createElement() {
    return {
      style: {},
      textContent: '',
      setAttribute() {},
      remove() {},
    };
  },
  body: {
    appendChild() {},
    removeChild() {},
  },
};

await import('../client.js');

const definition = globalThis.__peerLinkDefinition;
assert.ok(definition, 'client module must register a loader definition');
const plugin = definition.factory((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require: ${name}`);
});

test('client plugin registers its nav icon and main panel', async () => {
  const registrations = [];
  const localeDicts = {};
  let effectCount = 0;
  const locale = {
    register(_ns, dicts) {
      Object.assign(localeDicts, dicts);
      return () => {};
    },
    bind() {
      return (key) => key;
    },
    subscribe() {
      return () => {};
    },
    getSnapshot() {
      return { active: 'en', locales: [], revision: 0 };
    },
    getLocale() {
      return this.getSnapshot();
    },
  };
  const ctx = {
    locale,
    effect(fn) {
      effectCount += 1;
      return fn();
    },
    slots: {
      inject(_key, callback) {
        callback();
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  plugin.apply(ctx);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.ok(localeDicts.en?.title);
  assert.ok(localeDicts.zh?.title);
  const nav = registrations.find((item) => item.options.name === 'sidebar.panellist');
  const main = registrations.find((item) => item.options.name === 'main');
  const section = registrations.find((item) => item.options.name === 'settings.section');
  assert.equal(nav?.options.id, 'peer-link');
  assert.equal(main?.options.key, 'peer-link');
  assert.equal(registrations.some((item) => item.options.name === 'plugins.row.config'), false);
  assert.equal(section?.options.id, 'peer-link');
  assert.equal(section?.options.order, 18);
  assert.ok(effectCount >= 3);
  assert.equal(styleNodes.length, 1);

  resetHooks();
  const wrapperTree = main.component({});
  const panelTree = wrapperTree.type(wrapperTree.props);
  const panelText = collectText(panelTree).join(' ');
  assert.match(panelText, /Peer Link/);
  assert.match(panelText, /1 online/);

  const selfNode = findNode(panelTree, 'SelfCard');
  assert.ok(selfNode, 'panel must render the self card');
  assert.match(collectText(selfNode.type(selfNode.props)).join(' '), /Test Host/);

  const peerRowNode = findNode(panelTree, 'PeerRow');
  assert.ok(peerRowNode, 'panel must render a peer row for the discovered peer');
  resetHooks();
  const peerRowText = collectText(peerRowNode.type(peerRowNode.props)).join(' ');
  assert.match(peerRowText, /Other Host/);
  assert.match(peerRowText, /hi there/);

  resetHooks();
  const iconTree = nav.component({ size: 17, active: false });
  assert.ok(collectText(iconTree).length >= 0);

  // Select the peer by seeding the component's first useState slot, then walk
  // into Conversation and MessageBubble to catch render-time mistakes there.
  resetHooks();
  hooks.states[5] = 'bbbbbbbbbbbbbbbb';
  const selectedWrapper = main.component({});
  const selectedPanel = selectedWrapper.type(selectedWrapper.props);
  const conversationNode = findNode(selectedPanel, 'Conversation');
  assert.ok(conversationNode, 'selecting a peer must render the conversation');
  resetHooks();
  const conversationTree = conversationNode.type(conversationNode.props);
  const bubbleNode = findNode(conversationTree, 'MessageBubble');
  assert.ok(bubbleNode, 'conversation must render message bubbles');
  assert.match(collectText(bubbleNode.type(bubbleNode.props)).join(' '), /hello from peer/);

  await conversationNode.props.onSend({ id: 'bbbbbbbbbbbbbbbb', name: 'Other Host' }, 'send by peer object');
  assert.equal(lastSendBody.peer, 'bbbbbbbbbbbbbbbb');
  assert.equal(lastSendBody.text, 'send by peer object');
});

function findNode(node, componentName) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.type === 'function' && node.type.name === componentName) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findNode(child, componentName);
      if (found) return found;
    }
  } else if (children) {
    return findNode(children, componentName);
  }
  return null;
}
