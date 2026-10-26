window.__ModuleLoader__.load({
  id: '@local/dsh-peer-link',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'peer-link';
    const API = '/_peer-link/v1';
    const boot = globalThis.__DSH_PEER_LINK__ ?? {};
    const TOKEN = typeof boot.token === 'string' ? boot.token : '';

    const EN = {
      nav: 'Peer Link',
      title: 'Peer Link',
      refresh: 'Refresh',
      cleanOffline: 'Clean offline',
      cleanOfflineConfirm: 'Delete {n} offline peer(s) and their local chat history? This cannot be undone.',
      copyInfo: 'Copy connection info',
      copied: 'Copied',
      search: 'Search instances',
      noPeers: 'No instances yet',
      noMatches: 'No matching instances',
      noPeersHint: 'Install Peer Link on another Harness instance and sign in to the same DeepSeek account. Instances on this machine are discovered automatically.',
      noPeersLanOff: 'For another machine, set the same sharedSecret and enable LAN discovery in the plugin config.',
      lanOff: 'LAN discovery off',
      lanOn: 'LAN discovery on',
      relayOn: 'Relay connected',
      relayOff: 'Relay offline',
      relayError: 'Relay error',
      autoReplyOff: 'AI takeover',
      autoReplyOn: 'AI takeover on',
      autoReplyHint: 'Let the local agent handle incoming Peer Link messages automatically.',
      autoReplyNoAgent: 'AI takeover needs an open agent session on this instance.',
      autoReplyFailed: 'AI takeover failed',
      autoReplySessionLabel: 'Takeover session',
      autoReplyAuto: 'Automatic (single live session)',
      autoReplyOffline: 'offline',
      autoTag: 'AI',
      transports: 'Transports',
      sourceLocal: 'Local',
      sourceLan: 'LAN',
      sourceManual: 'Manual',
      sourceRelay: 'Relay',
      sourceInbound: 'Inbound',
      sourceHistory: 'History',
      settingsTitle: 'Peer Link settings',
      settingsSummary: 'Configure transports, pairing, and relay.',
      settingsHint: 'Changes are written to the plugin config and may reload the connection.',
      settingsReadOnly: 'This deployment stores plugin settings read-only.',
      settingsUnavailable: 'Plugin settings are unavailable; edit the profile patch instead.',
      settingsLoading: 'Loading settings…',
      chooseTransport: 'Choose at least one transport.',
      nameLabel: 'Instance name',
      namePlaceholder: 'Defaults to the host name',
      transportsLabel: 'Transports',
      transportLocal: 'This machine',
      transportLan: 'LAN',
      transportManual: 'Manual peers',
      transportRelay: 'WebSocket relay',
      listenHostLabel: 'Listen host',
      listenHostPlaceholder: 'Empty = 127.0.0.1',
      listenPortLabel: 'Listen port',
      udpPortLabel: 'UDP port',
      manualPeersLabel: 'Manual peers',
      manualPeersHint: 'One origin per line, for example http://192.168.1.20:45873',
      sharedSecretLabel: 'Pairing secret',
      sharedSecretSet: 'A secret is set; leave blank to keep it.',
      relayUrlLabel: 'Relay URL',
      relayUrlPlaceholder: 'wss://…/peer',
      relayTokenLabel: 'Relay token',
      relayTokenSet: 'A token is set; leave blank to keep it.',
      requireSameAccountLabel: 'Require the same account',
      maxMessagesLabel: 'Messages per conversation',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. The connection may reload.',
      saveFailed: 'Save failed',
      localMode: 'Local account only',
      signedIn: 'Same account',
      onlineCount: '{n} online',
      starting: 'Starting Peer Link…',
      errorTitle: 'Peer Link could not start',
      reload: 'Reload the page to finish installing the panel.',
      emptyTitle: 'Talk to your other Harness',
      emptyHint: 'Pick an instance on the left. Messages are encrypted in transit and only accepted from the same account and pairing key.',
      emptyStep1: 'Install this plugin on both instances',
      emptyStep2: 'Sign in with the same DeepSeek account',
      emptyStep3: 'For another machine, share one pairing key and enable LAN',
      self: 'This instance',
      instance: 'Instance',
      endpoint: 'Endpoint',
      key: 'Pairing key',
      mismatch: 'Key mismatch',
      mismatchCount: '{n} instance(s) use a different pairing key',
      mismatchTitle: 'Pairing key mismatch',
      mismatchBody: 'Both instances must use the same sharedSecret. Until then, messages cannot be sent safely.',
      offline: 'Offline',
      online: 'Online',
      checking: 'Checking…',
      you: 'You',
      queued: 'Queued',
      failed: 'Not delivered',
      startChat: 'No messages yet. Say hello.',
      placeholder: 'Write a message… Enter to send, Shift+Enter for a new line',
      offlinePlaceholder: 'Peer is offline; your message will be queued',
      send: 'Send',
      sending: 'Sending…',
      sendFailed: 'Send failed',
      connectionIssue: 'Connection issue',
      noAccount: 'Not signed in; local-only mode',
      stats: '{online} online · {known} known',
      lanError: 'LAN discovery error',
      manualError: 'Manual peer error',
      markRead: 'Mark all read',
      today: 'Today',
      yesterday: 'Yesterday',
      unread: '{n} unread',
      account: 'Account',
      loading: 'Loading…',
      retry: 'Retry',
    };

    const ZH = {
      nav: '实例互传',
      title: '实例互传',
      refresh: '刷新',
      cleanOffline: '清理离线',
      cleanOfflineConfirm: '删除 {n} 个离线 peer 及其本地聊天记录？此操作不可撤销。',
      copyInfo: '复制本机连接信息',
      copied: '已复制',
      search: '搜索实例',
      noPeers: '还没有发现其他实例',
      noMatches: '没有匹配的实例',
      noPeersHint: '在另一个 Harness 实例中安装本插件，并登录同一个 DeepSeek 账号。同一台电脑上的实例会自动发现。',
      noPeersLanOff: '跨电脑使用时，请在插件配置中为两端设置相同的 sharedSecret，并开启局域网发现。',
      lanOff: '局域网发现未开启',
      lanOn: '局域网发现已开启',
      relayOn: '中继已连接',
      relayOff: '中继未连接',
      relayError: '中继异常',
      autoReplyOff: 'AI 接管',
      autoReplyOn: 'AI 接管中',
      autoReplyHint: '让本机智能体自动处理收到的 Peer Link 消息。',
      autoReplyNoAgent: 'AI 接管需要本机有打开的智能体会话。',
      autoReplyFailed: 'AI 接管失败',
      autoReplySessionLabel: '接管会话',
      autoReplyAuto: '自动选择（唯一活跃会话）',
      autoReplyOffline: '已离线',
      autoTag: 'AI',
      transports: '连接方式',
      sourceLocal: '本机',
      sourceLan: '局域网',
      sourceManual: '手动',
      sourceRelay: '中继',
      sourceInbound: '入站',
      sourceHistory: '历史',
      settingsTitle: '实例互传设置',
      settingsSummary: '配置连接方式、配对密钥和中继。',
      settingsHint: '变更会写入插件配置，可能需要重新加载连接。',
      settingsReadOnly: '当前部署的插件设置为只读。',
      settingsUnavailable: '插件设置服务不可用，请改用 profile 补丁。',
      settingsLoading: '正在加载设置…',
      chooseTransport: '请至少选择一种连接方式。',
      nameLabel: '实例名称',
      namePlaceholder: '默认使用主机名',
      transportsLabel: '连接方式',
      transportLocal: '本机',
      transportLan: '局域网',
      transportManual: '手动节点',
      transportRelay: 'WebSocket 中继',
      listenHostLabel: '监听地址',
      listenHostPlaceholder: '留空 = 127.0.0.1',
      listenPortLabel: '监听端口',
      udpPortLabel: 'UDP 端口',
      manualPeersLabel: '手动节点',
      manualPeersHint: '每行一个地址，例如 http://192.168.1.20:45873',
      sharedSecretLabel: '配对密钥',
      sharedSecretSet: '已设置；留空表示不修改。',
      relayUrlLabel: '中继地址',
      relayUrlPlaceholder: 'wss://…/peer',
      relayTokenLabel: '中继令牌',
      relayTokenSet: '已设置；留空表示不修改。',
      requireSameAccountLabel: '要求同账号',
      maxMessagesLabel: '每个会话保留消息数',
      save: '保存',
      saving: '保存中…',
      saved: '已保存。连接可能会重新加载。',
      saveFailed: '保存失败',
      localMode: '仅本机身份',
      signedIn: '同账号',
      onlineCount: '{n} 个在线',
      starting: '正在启动实例互传…',
      errorTitle: '实例互传启动失败',
      reload: '请刷新页面，完成面板加载。',
      emptyTitle: '和你的另一个 Harness 聊天',
      emptyHint: '从左侧选择一个实例。消息在传输中加密，只接受同账号且配对密钥一致的实例。',
      emptyStep1: '在两个实例中都安装本插件',
      emptyStep2: '登录同一个 DeepSeek 账号',
      emptyStep3: '跨电脑时，设置相同的配对密钥并开启局域网',
      self: '本机',
      instance: '实例',
      endpoint: '连接地址',
      key: '配对密钥',
      mismatch: '密钥不一致',
      mismatchCount: '有 {n} 个实例的配对密钥不一致',
      mismatchTitle: '配对密钥不一致',
      mismatchBody: '两端的 sharedSecret 必须相同，否则无法安全地发送消息。',
      offline: '离线',
      online: '在线',
      checking: '检测中…',
      you: '我',
      queued: '排队中',
      failed: '未送达',
      startChat: '还没有消息，打个招呼吧。',
      placeholder: '输入消息… Enter 发送，Shift+Enter 换行',
      offlinePlaceholder: '对方离线，消息会先排队',
      send: '发送',
      sending: '发送中…',
      sendFailed: '发送失败',
      connectionIssue: '连接异常',
      noAccount: '未登录账号，当前仅限本机',
      stats: '{online} 在线 · {known} 已知',
      lanError: '局域网发现异常',
      manualError: '手动节点异常',
      markRead: '全部标为已读',
      today: '今天',
      yesterday: '昨天',
      unread: '{n} 条未读',
      account: '账号',
      loading: '加载中…',
      retry: '重试',
    };

    let snapshot = null;
    let started = false;
    let eventSource = null;
    let pollTimer = null;
    let retryTimer = null;
    let lastError = '';
    const listeners = new Set();

    function getSnapshot() {
      return snapshot;
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function publish(next) {
      snapshot = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // A crashed subscriber must not stop the rest.
        }
      }
    }

    function authHeaders() {
      return TOKEN ? { 'x-peer-link-token': TOKEN } : {};
    }

    async function request(path, options = {}) {
      const response = await fetch(`${API}${path}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...options,
        headers: {
          ...authHeaders(),
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers ?? {}),
        },
      });
      let json = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      if (!response.ok || json?.ok === false) {
        const error = new Error(json?.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return json;
    }

    async function refresh() {
      try {
        const state = await request('/state');
        lastError = '';
        publish(state);
      } catch (error) {
        lastError = error?.message ?? String(error);
        publish({
          ...(snapshot ?? {}),
          ready: false,
          status: error?.status === 401 ? 'auth' : 'error',
          error: lastError,
          peers: snapshot?.peers ?? [],
          conversations: snapshot?.conversations ?? {},
          self: snapshot?.self ?? { name: 'Peer Link', account: { signedIn: false, label: '' }, lan: false },
          stats: snapshot?.stats ?? { online: 0, known: 0, unread: 0, mismatched: 0 },
        });
      }
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void refresh();
      }, 4_000);
    }

    function stopPolling() {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
    }

    function closeEvents() {
      if (!eventSource) return;
      try {
        eventSource.close();
      } catch {
        // already closed
      }
      eventSource = null;
    }

    function scheduleReconnect() {
      if (retryTimer || !started) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (started) openEvents();
      }, 2_500);
    }

    function openEvents() {
      if (!started || eventSource) return;
      try {
        const query = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : '';
        eventSource = new EventSource(`${API}/events${query}`);
        eventSource.addEventListener('state', (event) => {
          try {
            const next = JSON.parse(event.data);
            lastError = '';
            publish(next);
            stopPolling();
          } catch {
            // Ignore a malformed frame; the next one will supersede it.
          }
        });
        eventSource.onopen = () => {
          stopPolling();
        };
        eventSource.onerror = () => {
          closeEvents();
          startPolling();
          scheduleReconnect();
        };
      } catch {
        startPolling();
        scheduleReconnect();
      }
    }

    function start() {
      if (started) return () => {};
      started = true;
      void refresh();
      openEvents();
      return () => {
        started = false;
        closeEvents();
        stopPolling();
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
      };
    }

    async function sendMessage(peer, text) {
      const peerId = typeof peer === 'string' ? peer : peer?.id;
      if (!peerId) throw new Error('peer is required');
      const result = await request('/send', {
        method: 'POST',
        body: JSON.stringify({ peer: peerId, text }),
      });
      await refresh();
      return result.result;
    }

    async function forgetPeer(peerId) {
      return request('/forget', {
        method: 'POST',
        body: JSON.stringify({ peer: peerId }),
      });
    }

    function markRead(peerId) {
      if (!snapshot) return;
      const peer = snapshot.peers.find((item) => item.id === peerId);
      if (!peer || !peer.unread) {
        void request('/read', { method: 'POST', body: JSON.stringify({ peer: peerId }) }).catch(() => {});
        return;
      }
      publish({
        ...snapshot,
        peers: snapshot.peers.map((item) => item.id === peerId ? { ...item, unread: 0 } : item),
        stats: {
          ...snapshot.stats,
          unread: Math.max(0, Number(snapshot.stats.unread ?? 0) - Number(peer.unread ?? 0)),
        },
      });
      void request('/read', { method: 'POST', body: JSON.stringify({ peer: peerId }) }).catch(() => {});
    }

    async function refreshPeers() {
      await request('/refresh', { method: 'POST', body: '{}' });
      await refresh();
    }

    async function identityText() {
      const result = await request('/identity');
      return result.shareText || '';
    }

    async function loadConfig() {
      return request('/config');
    }

    async function saveConfig(patch) {
      return request('/config', {
        method: 'POST',
        body: JSON.stringify(patch),
      });
    }

    async function loadAgents() {
      return request('/agents');
    }

    function useSnapshot() {
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    function useT(ctx) {
      const subscribeLocale = React.useCallback((listener) => {
        if (!ctx.locale?.subscribe) return () => {};
        return ctx.locale.subscribe(listener);
      }, [ctx]);
      const getLocale = React.useCallback(() => ctx.locale?.getSnapshot?.() ?? EMPTY_LOCALE, [ctx]);
      React.useSyncExternalStore(subscribeLocale, getLocale, getLocale);
      return React.useCallback((key, params) => {
        if (ctx.locale?.bind) {
          const translated = ctx.locale.bind(NS)(key, params);
          if (translated !== key) return translated;
        }
        let value = EN[key] ?? key;
        if (params) value = value.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
        return value;
      }, [ctx]);
    }

    const EMPTY_LOCALE = Object.freeze({ active: 'en', locales: [], revision: 0 });

    function initials(name) {
      const value = String(name || '?').trim();
      return [...value].slice(0, 1).join('').toUpperCase() || '?';
    }

    function hueFor(id) {
      let hash = 0;
      for (const char of String(id || '')) hash = (hash * 31 + char.charCodeAt(0)) % 360;
      return hash;
    }

    function avatarStyle(peer) {
      return { background: `hsl(${hueFor(peer.id)} 58% 45%)` };
    }

    function formatTime(value) {
      const date = new Date(Number(value));
      if (Number.isNaN(date.getTime())) return '';
      const now = new Date();
      const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (date.toDateString() === now.toDateString()) return time;
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
    }

    function dayKey(value) {
      const date = new Date(Number(value));
      return Number.isNaN(date.getTime()) ? '' : date.toDateString();
    }

    function dayLabel(value) {
      const date = new Date(Number(value));
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      if (date.toDateString() === today.toDateString()) return 'today';
      if (date.toDateString() === yesterday.toDateString()) return 'yesterday';
      return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function statusText(t, peer) {
      if (!peer) return '';
      if (peer.keyMatch === false) return t('mismatch');
      if (peer.online) return t('online');
      return t('offline');
    }

    function sourceLabel(t, source) {
      switch (source) {
        case 'local': return t('sourceLocal');
        case 'lan': return t('sourceLan');
        case 'manual': return t('sourceManual');
        case 'relay': return t('sourceRelay');
        case 'inbound': return t('sourceInbound');
        case 'history': return t('sourceHistory');
        default: return source || '';
      }
    }

    function Icon({ path, size = 18, viewBox = '0 0 24 24', children, ...rest }) {
      return h('svg', {
        viewBox,
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
        ...rest,
      }, children ?? (path ? h('path', { d: path }) : null));
    }

    function ChatGlyph({ size = 18 }) {
      return h(Icon, { size, viewBox: '0 0 24 24' },
        h('path', { d: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v4A2.5 2.5 0 0 1 13.5 13H9l-3.4 2.6a.6.6 0 0 1-.95-.48V13A2.5 2.5 0 0 1 4 10.5z' }),
        h('path', { d: 'M9 16.5A2.5 2.5 0 0 0 11.5 19h3.9l2.6 2a.6.6 0 0 0 .95-.48V19A2.5 2.5 0 0 0 21.5 16.5v-3A2.5 2.5 0 0 0 19 11h-2' }),
      );
    }

    function PeerIcon({ size = 17, active }) {
      const state = useSnapshot();
      const unread = Number(state?.stats?.unread ?? 0);
      return h('span', {
        className: `dspl-navicon${active ? ' active' : ''}`,
        style: { width: size, height: size },
        'aria-hidden': true,
      },
        h(ChatGlyph, { size }),
        unread > 0 ? h('span', { className: 'dspl-navdot' }) : null,
      );
    }

    function Avatar({ peer, size = 34 }) {
      return h('span', {
        className: 'dspl-avatar',
        style: { ...avatarStyle(peer), width: size, height: size, fontSize: Math.round(size * 0.42) },
        'aria-hidden': true,
      }, initials(peer.name));
    }

    function PeerRow({ peer, selected, t, onSelect }) {
      const preview = peer.lastMessage
        ? `${peer.lastMessage.dir === 'out' ? `${t('you')}: ` : ''}${peer.lastMessage.text}`
        : t('startChat');
      return h('button', {
        type: 'button',
        className: `dspl-peer${selected ? ' selected' : ''}`,
        onClick: () => onSelect(peer),
        'aria-pressed': selected,
      },
        h(Avatar, { peer }),
        h('span', { className: 'dspl-peer-main' },
          h('span', { className: 'dspl-peer-top' },
            h('span', { className: 'dspl-peer-name' }, peer.name),
            h('span', { className: 'dspl-peer-time' }, peer.lastMessage ? formatTime(peer.lastMessage.at) : ''),
          ),
          h('span', { className: 'dspl-peer-bottom' },
            h('span', { className: 'dspl-peer-preview' }, preview),
            peer.unread > 0 ? h('span', { className: 'dspl-badge' }, peer.unread > 99 ? '99+' : String(peer.unread)) : null,
          ),
        ),
        h('span', {
          className: `dspl-presence${peer.online ? ' online' : ''}${peer.keyMatch === false ? ' warn' : ''}`,
          title: statusText(t, peer),
        }),
      );
    }

    function SelfCard({ state, t, onCopy, copied }) {
      const self = state?.self;
      const [open, setOpen] = React.useState(false);
      const rootRef = React.useRef(null);

      React.useEffect(() => {
        if (!open) return undefined;
        const closeOutside = (event) => {
          if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        const closeOnEscape = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside, true);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
          document.removeEventListener('pointerdown', closeOutside, true);
          document.removeEventListener('keydown', closeOnEscape);
        };
      }, [open]);

      if (!self) return null;

      const closeOnBlur = (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      };

      return h('div', {
        className: `dspl-self${open ? ' open' : ''}`,
        ref: rootRef,
        onBlur: closeOnBlur,
      },
        h('button', {
          type: 'button',
          className: 'dspl-self-toggle',
          onClick: () => setOpen((value) => !value),
          'aria-expanded': open,
          'aria-label': t('self'),
        },
          h('span', { className: 'dspl-self-label' }, t('self')),
          h('span', { className: 'dspl-self-name', title: self.name }, self.name),
          h(Icon, {
            path: open ? 'M8 14l4-4 4 4' : 'M8 10l4 4 4-4',
            size: 14,
          }),
        ),
        open
          ? h('div', { className: 'dspl-self-body' },
            h('div', { className: 'dspl-mono' }, `#${String(self.instanceId || '').slice(0, 8)} · ${self.endpoint || '—'}`),
            h('div', { className: 'dspl-mono dspl-muted' }, `${t('key')}: ${self.keyFingerprint || '—'}`),
            h('button', { type: 'button', className: 'dspl-linkbtn', onClick: onCopy },
              h(Icon, { path: 'M9 9h9v9H9z M6 15H4V4h11v2', size: 14 }),
              h('span', null, copied ? t('copied') : t('copyInfo')),
            ),
          )
          : null,
      );
    }

    function readConfigForm(configForm) {
      if (!configForm) return null;
      let state = configForm.state;
      if (typeof state === 'function') state = state();
      else if (state && typeof state.getSnapshot === 'function') state = state.getSnapshot();
      if (!state || typeof state !== 'object') return null;
      if (typeof state.status === 'string' && state.status !== 'ready') return null;
      return {
        value: state.value ?? state.values ?? state.config ?? state.data ?? {},
        secrets: Array.isArray(state.secrets)
          ? state.secrets
          : Array.isArray(state.redactedSecrets) ? state.redactedSecrets : [],
        revision: state.revision ?? state.expectedRevision,
        writable: state.writable !== false && state.readOnly !== true,
      };
    }

    function PeerSettingsPanel({ ctx, view, configForm, showHeader }) {
      const t = useT(ctx);
      const [loading, setLoading] = React.useState(true);
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState('');
      const [saved, setSaved] = React.useState(false);
      const [secrets, setSecrets] = React.useState([]);
      const [revision, setRevision] = React.useState(undefined);
      const [writable, setWritable] = React.useState(true);
      const [agents, setAgents] = React.useState([]);
      const [form, setForm] = React.useState({
        name: '',
        transports: ['local'],
        listenHost: '',
        listenPort: 0,
        udpPort: 45872,
        manualPeers: '',
        sharedSecret: '',
        relayUrl: '',
        relayToken: '',
        requireSameAccount: true,
        autoReply: false,
        autoReplySession: '',
        maxMessages: 300,
      });

      const applyValue = (value, secretList = []) => {
        const current = value && typeof value === 'object' ? value : {};
        setSecrets(Array.isArray(secretList) ? secretList : []);
        setForm({
          name: typeof current.name === 'string' ? current.name : '',
          transports: Array.isArray(current.transports) && current.transports.length > 0 ? current.transports : ['local'],
          listenHost: typeof current.listenHost === 'string' ? current.listenHost : '',
          listenPort: Number.isInteger(current.listenPort) ? current.listenPort : 0,
          udpPort: Number.isInteger(current.udpPort) ? current.udpPort : 45872,
          manualPeers: Array.isArray(current.manualPeers) ? current.manualPeers.join('\n') : '',
          sharedSecret: '',
          relayUrl: typeof current.relayUrl === 'string' ? current.relayUrl : '',
          relayToken: '',
          requireSameAccount: current.requireSameAccount !== false,
          autoReply: current.autoReply === true,
          autoReplySession: typeof current.autoReplySession === 'string' ? current.autoReplySession : '',
          maxMessages: Number.isInteger(current.maxMessages) ? current.maxMessages : 300,
        });
      };

      const load = async () => {
        setLoading(true);
        setError('');
        try {
          const result = await loadConfig();
          applyValue(result.value ?? {}, result.secrets);
          setRevision(result.revision);
          setWritable(true);
        } catch (loadError) {
          setError(loadError?.message ?? String(loadError));
        } finally {
          setLoading(false);
        }
      };

      React.useEffect(() => {
        void loadAgents().then((result) => {
          setAgents(Array.isArray(result.agents) ? result.agents : []);
        }).catch(() => {});
      }, []);

      React.useEffect(() => {
        const snapshot = readConfigForm(configForm);
        if (snapshot) {
          applyValue(snapshot.value, snapshot.secrets);
          setRevision(snapshot.revision);
          setWritable(snapshot.writable);
          setLoading(false);
          return;
        }
        void load();
      }, [configForm]);

      if (view === 'summary') {
        return h('span', { className: 'dspl-muted' }, t('settingsSummary'));
      }

      if (loading) {
        return h('div', { className: 'dspl-settings dspl-settings-loading' },
          h('span', { className: 'dspl-spinner' }),
          h('span', null, t('settingsLoading')),
        );
      }

      const secretSet = (name) => secrets.some((item) => Array.isArray(item.path) && item.path[0] === name && item.set);

      const toggleTransport = (name) => {
        setForm((current) => {
          const has = current.transports.includes(name);
          return {
            ...current,
            transports: has
              ? current.transports.filter((item) => item !== name)
              : [...current.transports, name],
          };
        });
      };

      const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

      const submit = async (event) => {
        event?.preventDefault?.();
        if (saving || !writable) return;
        if (form.transports.length === 0) {
          setError(t('chooseTransport'));
          return;
        }
        setSaving(true);
        setError('');
        setSaved(false);
        try {
          const patch = {
            name: form.name,
            transports: form.transports,
            listenHost: form.listenHost,
            listenPort: Math.max(0, Number(form.listenPort) || 0),
            udpPort: Math.max(1, Number(form.udpPort) || 45872),
            manualPeers: form.manualPeers.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
            relayUrl: form.relayUrl,
            requireSameAccount: Boolean(form.requireSameAccount),
            autoReply: Boolean(form.autoReply),
            autoReplySession: form.autoReplySession,
            maxMessages: Math.max(50, Math.min(2000, Number(form.maxMessages) || 300)),
          };
          if (form.sharedSecret) patch.sharedSecret = form.sharedSecret;
          if (form.relayToken) patch.relayToken = form.relayToken;
          if (typeof configForm?.mutate === 'function') {
            const operations = Object.entries(patch).map(([key, value]) => ({ op: 'set', path: [key], value }));
            const result = await configForm.mutate(operations, revision);
            if (result && result.ok === false) throw new Error(result.error || 'save failed');
          } else {
            await saveConfig(patch);
          }
          setSaved(true);
        } catch (saveError) {
          setError(saveError?.message ?? String(saveError));
        } finally {
          setSaving(false);
        }
      };

      return h('form', { className: 'dspl-settings', onSubmit: submit },
        showHeader
          ? h('div', { className: 'dspl-settings-title' },
            h('h2', null, t('settingsTitle')),
          )
          : null,
        h('p', { className: 'dspl-settings-intro' }, t('settingsHint')),
        !writable ? h('div', { className: 'dspl-banner warn' }, t('settingsReadOnly')) : null,
        error ? h('div', { className: 'dspl-banner bad' }, error) : null,
        saved ? h('div', { className: 'dspl-banner good' }, t('saved')) : null,

        h('section', { className: 'dspl-settings-section' },
          h('h3', null, t('transportsLabel')),
          h('div', { className: 'dspl-checks' },
            ['local', 'lan', 'manual', 'relay'].map((name) => h('label', { className: 'dspl-check', key: name },
              h('input', {
                type: 'checkbox',
                checked: form.transports.includes(name),
                onChange: () => toggleTransport(name),
              }),
              h('span', null, t(`transport${name[0].toUpperCase()}${name.slice(1)}`)),
            )),
          ),
          h('p', { className: 'dspl-settings-note' }, t('noPeersLanOff')),
        ),

        h('section', { className: 'dspl-settings-section' },
          h('h3', null, t('nameLabel')),
          h('input', {
            className: 'dspl-input',
            value: form.name,
            placeholder: t('namePlaceholder'),
            onChange: (event) => set('name', event.target.value),
          }),
        ),

        h('section', { className: 'dspl-settings-section' },
          h('h3', null, t('listenHostLabel')),
          h('div', { className: 'dspl-grid three' },
            h('label', { className: 'dspl-field' },
              h('span', null, t('listenHostLabel')),
              h('input', {
                className: 'dspl-input',
                value: form.listenHost,
                placeholder: t('listenHostPlaceholder'),
                onChange: (event) => set('listenHost', event.target.value),
              }),
            ),
            h('label', { className: 'dspl-field' },
              h('span', null, t('listenPortLabel')),
              h('input', {
                className: 'dspl-input',
                type: 'number',
                min: 0,
                max: 65535,
                value: form.listenPort,
                onChange: (event) => set('listenPort', Number(event.target.value)),
              }),
            ),
            h('label', { className: 'dspl-field' },
              h('span', null, t('udpPortLabel')),
              h('input', {
                className: 'dspl-input',
                type: 'number',
                min: 1,
                max: 65535,
                value: form.udpPort,
                onChange: (event) => set('udpPort', Number(event.target.value)),
              }),
            ),
          ),
        ),

        h('section', { className: 'dspl-settings-section' },
          h('h3', null, t('manualPeersLabel')),
          h('textarea', {
            className: 'dspl-input dspl-textarea',
            rows: 3,
            value: form.manualPeers,
            placeholder: 'http://192.168.1.20:45873',
            onChange: (event) => set('manualPeers', event.target.value),
          }),
          h('p', { className: 'dspl-settings-note' }, t('manualPeersHint')),
        ),

        h('section', { className: 'dspl-settings-section' },
          h('h3', null, t('sharedSecretLabel')),
          h('input', {
            className: 'dspl-input',
            type: 'password',
            value: form.sharedSecret,
            placeholder: secretSet('sharedSecret') ? t('sharedSecretSet') : '',
            onChange: (event) => set('sharedSecret', event.target.value),
          }),
        ),

        h('section', { className: 'dspl-settings-section' },
          h('h3', null, t('relayUrlLabel')),
          h('input', {
            className: 'dspl-input',
            value: form.relayUrl,
            placeholder: t('relayUrlPlaceholder'),
            onChange: (event) => set('relayUrl', event.target.value),
          }),
          h('label', { className: 'dspl-field dspl-field-gap' },
            h('span', null, t('relayTokenLabel')),
            h('input', {
              className: 'dspl-input',
              type: 'password',
              value: form.relayToken,
              placeholder: secretSet('relayToken') ? t('relayTokenSet') : '',
              onChange: (event) => set('relayToken', event.target.value),
            }),
          ),
        ),

        h('section', { className: 'dspl-settings-section' },
          h('label', { className: 'dspl-check' },
            h('input', {
              type: 'checkbox',
              checked: form.autoReply,
              onChange: (event) => set('autoReply', event.target.checked),
            }),
            h('span', null, t('autoReplyHint')),
          ),
          h('label', { className: 'dspl-field dspl-field-gap' },
            h('span', null, t('autoReplySessionLabel')),
            h('select', {
              className: 'dspl-input',
              value: form.autoReplySession,
              onChange: (event) => set('autoReplySession', event.target.value),
            },
              h('option', { value: '' }, t('autoReplyAuto')),
              agents.map((agent) => h('option', {
                value: agent.id,
                key: agent.id,
                title: `${agent.title || agent.id} (${agent.id})`,
              },
                `${agent.title || agent.id.slice(0, 8)} · ${String(agent.id).slice(0, 8)}`,
              )),
              form.autoReplySession && !agents.some((agent) => agent.id === form.autoReplySession)
                ? h('option', { value: form.autoReplySession }, `${String(form.autoReplySession).slice(0, 8)} · ${t('autoReplyOffline')}`)
                : null,
            ),
          ),
          h('label', { className: 'dspl-check' },
            h('input', {
              type: 'checkbox',
              checked: form.requireSameAccount,
              onChange: (event) => set('requireSameAccount', event.target.checked),
            }),
            h('span', null, t('requireSameAccountLabel')),
          ),
          h('label', { className: 'dspl-field dspl-field-gap' },
            h('span', null, t('maxMessagesLabel')),
            h('input', {
              className: 'dspl-input',
              type: 'number',
              min: 50,
              max: 2000,
              value: form.maxMessages,
              onChange: (event) => set('maxMessages', Number(event.target.value)),
            }),
          ),
        ),

        h('div', { className: 'dspl-settings-actions' },
          h('button', { type: 'submit', className: 'dspl-primary', disabled: saving || !writable },
            saving ? t('saving') : t('save'),
          ),
        ),
      );
    }

    function EmptyState({ state, t }) {
      return h('div', { className: 'dspl-empty' },
        h('div', { className: 'dspl-empty-mark' }, h(ChatGlyph, { size: 34 })),
        h('h2', null, t('emptyTitle')),
        h('p', { className: 'dspl-empty-hint' }, t('emptyHint')),
        h('ol', { className: 'dspl-steps' },
          h('li', null, t('emptyStep1')),
          h('li', null, t('emptyStep2')),
          h('li', null, t('emptyStep3')),
        ),
        !state?.self?.lan ? h('p', { className: 'dspl-note' }, t('noPeersLanOff')) : null,
      );
    }

    function MessageBubble({ message, t }) {
      const outgoing = message.dir === 'out';
      const failed = outgoing && message.status === 'failed';
      return h('div', { className: `dspl-msg ${outgoing ? 'out' : 'in'}` },
        h('div', { className: `dspl-bubble${failed ? ' failed' : ''}` }, message.text),
        h('div', { className: 'dspl-meta' },
          h('span', null, formatTime(message.at)),
          message.auto ? h('span', { className: 'dspl-auto' }, t('autoTag')) : null,
          outgoing ? h('span', { className: `dspl-state${failed ? ' bad' : ''}` },
            message.status === 'sent' ? '✓' : failed ? t('failed') : t('queued'),
          ) : null,
        ),
      );
    }

    function Conversation({ peer, messages, state, t, onSend, onMarkRead }) {
      const [draft, setDraft] = React.useState('');
      const [sending, setSending] = React.useState(false);
      const [sendError, setSendError] = React.useState('');
      const textareaRef = React.useRef(null);
      const scrollRef = React.useRef(null);
      const stickToBottom = React.useRef(true);
      const messageCount = messages.length;

      React.useEffect(() => {
        setDraft('');
        setSendError('');
        stickToBottom.current = true;
      }, [peer.id]);

      React.useEffect(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.style.height = 'auto';
        node.style.height = `${Math.min(node.scrollHeight, 148)}px`;
      }, [draft]);

      React.useEffect(() => {
        const node = scrollRef.current;
        if (!node) return;
        if (stickToBottom.current) node.scrollTop = node.scrollHeight;
      }, [peer.id, messageCount]);

      const onScroll = (event) => {
        const node = event.currentTarget;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 110;
      };

      const keyMismatch = peer.keyMatch === false;
      const canSend = draft.trim().length > 0 && !sending && !keyMismatch;

      const submit = async (event) => {
        event?.preventDefault?.();
        if (!canSend) return;
        setSending(true);
        setSendError('');
        try {
          await onSend(peer, draft.trim());
          setDraft('');
        } catch (error) {
          setSendError(error?.message ?? String(error));
        } finally {
          setSending(false);
        }
      };

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
          event.preventDefault();
          void submit();
        }
      };

      let lastDay = '';
      const rows = [];
      for (const message of messages) {
        const key = dayKey(message.at);
        if (key !== lastDay) {
          lastDay = key;
          rows.push(h('div', { className: 'dspl-day', key: `day:${key}` }, dayLabel(message.at) === 'today' ? t('today') : dayLabel(message.at) === 'yesterday' ? t('yesterday') : dayLabel(message.at)));
        }
        rows.push(h(MessageBubble, { message, t, key: message.id }));
      }

      return h('section', { className: 'dspl-chat' },
        h('header', { className: 'dspl-chat-head' },
          h(Avatar, { peer, size: 38 }),
          h('div', { className: 'dspl-chat-title' },
            h('h2', null, peer.name),
            h('p', null, statusText(t, peer),
              peer.unread > 0 ? ` · ${t('unread', { n: peer.unread })}` : '',
            ),
          ),
          peer.unread > 0 ? h('button', { type: 'button', className: 'dspl-ghost', onClick: () => onMarkRead(peer) }, t('markRead')) : null,
        ),
        keyMismatch ? h('div', { className: 'dspl-banner warn' },
          h('strong', null, t('mismatchTitle')),
          h('span', null, t('mismatchBody')),
        ) : null,
        h('div', { className: 'dspl-messages', ref: scrollRef, onScroll },
          rows.length === 0 ? h('div', { className: 'dspl-chat-empty' }, t('startChat')) : rows,
        ),
        h('form', { className: 'dspl-composer', onSubmit: submit },
          sendError ? h('div', { className: 'dspl-banner bad' }, `${t('sendFailed')}: ${sendError}`) : null,
          h('div', { className: 'dspl-composer-box' },
            h('textarea', {
              ref: textareaRef,
              value: draft,
              rows: 1,
              disabled: keyMismatch,
              placeholder: peer.online ? t('placeholder') : t('offlinePlaceholder'),
              onChange: (event) => setDraft(event.target.value),
              onKeyDown,
              'aria-label': t('placeholder'),
            }),
            h('button', {
              type: 'submit',
              className: 'dspl-send',
              disabled: !canSend,
              title: t('send'),
              'aria-label': t('send'),
            }, sending
              ? h('span', { className: 'dspl-spinner' })
              : h(Icon, { path: 'M4 12 20 4l-4 16-4.5-6.5L4 12Z', size: 17 }),
            ),
          ),
          h('div', { className: 'dspl-composer-foot' },
            h('span', null, sourceLabel(t, peer.source)),
            h('span', null, t('stats', { online: state?.stats?.online ?? 0, known: state?.stats?.known ?? 0 })),
          ),
        ),
      );
    }

    function PeerPanel({ ctx }) {
      const t = useT(ctx);
      const state = useSnapshot();
      const [selectedId, setSelectedId] = React.useState(null);
      const [query, setQuery] = React.useState('');
      const [copied, setCopied] = React.useState(false);
      const [busy, setBusy] = React.useState(false);

      const peers = Array.isArray(state?.peers) ? state.peers : [];
      const filtered = query.trim()
        ? peers.filter((peer) => `${peer.name} ${peer.id}`.toLowerCase().includes(query.trim().toLowerCase()))
        : peers;
      const selected = peers.find((peer) => peer.id === selectedId) ?? null;
      const conversations = state?.conversations ?? {};
      const messages = selected ? (conversations[selected.id] ?? []) : [];

      const onSelect = (peer) => {
        setSelectedId(peer.id);
        if (peer.unread > 0) markRead(peer.id);
      };

      const onCopy = async () => {
        try {
          const text = await identityText();
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const area = document.createElement('textarea');
            area.value = text;
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 1_800);
        } catch {
          setCopied(false);
        }
      };

      const onRefresh = async () => {
        setBusy(true);
        try {
          await refreshPeers();
        } catch {
          // The banner already reports transport errors.
        } finally {
          setBusy(false);
        }
      };

      const onToggleAuto = async () => {
        const enabled = !(state.self?.autoReply === true);
        setBusy(true);
        try {
          await saveConfig({ autoReply: enabled });
          await refresh();
        } catch {
          // The banner reports the failure.
        } finally {
          setBusy(false);
        }
      };

      const onCleanOffline = async () => {
        const offline = (state.peers ?? []).filter((peer) => !peer.online);
        if (offline.length === 0) return;
        if (!window.confirm(t('cleanOfflineConfirm', { n: offline.length }))) return;
        setBusy(true);
        try {
          for (const peer of offline) await forgetPeer(peer.id);
          await refresh();
        } catch {
          // The banner reports the failure.
        } finally {
          setBusy(false);
        }
      };

      if (!state) {
        return h('div', { className: 'dspl-root dspl-center' },
          h('div', { className: 'dspl-spinner large' }),
          h('p', { className: 'dspl-muted' }, t('loading')),
        );
      }

      if (state.status === 'auth') {
        return h('div', { className: 'dspl-root dspl-center' },
          h('div', { className: 'dspl-empty-mark' }, h(ChatGlyph, { size: 30 })),
          h('h2', null, t('errorTitle')),
          h('p', { className: 'dspl-empty-hint' }, t('reload')),
          h('button', { type: 'button', className: 'dspl-primary', onClick: () => location.reload() }, t('retry')),
        );
      }

      const error = state.status === 'error' ? state.error : '';
      const self = state.self ?? {};
      const account = self.account ?? { signedIn: false, label: '' };
      const keyMismatches = peers.filter((peer) => peer.keyMatch === false).length;
      const transports = Array.isArray(self.transports) ? self.transports : [];
      const relay = self.relay ?? {};
      const relayEnabled = relay.enabled === true || transports.includes('relay');
      const autoReply = self.autoReply === true;
      const offlinePeers = (state.peers ?? []).filter((peer) => !peer.online);

      return h('div', { className: 'dspl-root' },
        h('header', { className: 'dspl-head' },
          h('div', { className: 'dspl-head-main' },
            h('div', { className: 'dspl-brand' }, h(ChatGlyph, { size: 22 })),
            h('div', null,
              h('h1', null, t('title')),
            ),
          ),
          h('div', { className: 'dspl-head-actions' },
            h('button', {
              type: 'button',
              className: `dspl-ghost${autoReply ? ' active' : ''}`,
              onClick: onToggleAuto,
              disabled: busy || !state.ready,
              title: self.autoError || t('autoReplyHint'),
            }, h(Icon, { path: 'M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z', size: 16 }), h('span', null, autoReply ? t('autoReplyOn') : t('autoReplyOff'))),
            h('button', {
              type: 'button',
              className: `dspl-ghost${busy ? ' busy' : ''}`,
              onClick: onRefresh,
              disabled: busy || !state.ready,
              title: t('refresh'),
            }, h(Icon, { path: 'M20 11a8 8 0 1 0-2.3 6.7 M20 5v6h-6', size: 16 }), h('span', null, t('refresh'))),
          ),
        ),
        h('div', { className: 'dspl-chips' },
          h('span', { className: `dspl-chip${account.signedIn ? ' good' : ' warn'}` },
            h('span', { className: `dspl-dot${account.signedIn ? ' good' : ' warn'}` }),
            account.signedIn ? t('signedIn') : t('localMode'),
            account.label ? h('span', { className: 'dspl-chip-sub' }, account.label) : null,
          ),
          h('span', { className: 'dspl-chip' }, t('onlineCount', { n: state.stats?.online ?? 0 })),
          transports.includes('lan')
            ? h('span', { className: 'dspl-chip muted' }, self.lan ? t('lanOn') : t('lanOff'))
            : null,
          relayEnabled
            ? h('span', {
              className: `dspl-chip${relay.connected ? ' good' : ' warn'}`,
              title: relay.error || '',
            },
              h('span', { className: `dspl-dot${relay.connected ? ' good' : ' warn'}` }),
              relay.connected ? t('relayOn') : t('relayOff'),
            )
            : null,
          keyMismatches > 0
            ? h('span', { className: 'dspl-chip warn' }, t('mismatchCount', { n: keyMismatches }))
            : null,
        ),
        !state.ready && state.status === 'starting'
          ? h('div', { className: 'dspl-banner' },
            h('span', { className: 'dspl-spinner' }),
            h('span', null, t('starting')),
          )
          : null,
        error ? h('div', { className: 'dspl-banner bad' },
          h('strong', null, state.status === 'error' ? t('errorTitle') : t('connectionIssue')),
          h('span', null, error),
        ) : null,
        state.errors?.lan ? h('div', { className: 'dspl-banner warn' }, `${t('lanError')}: ${state.errors.lan}`) : null,
        state.errors?.manual ? h('div', { className: 'dspl-banner warn' }, `${t('manualError')}: ${state.errors.manual}`) : null,
        relayEnabled && relay.error
          ? h('div', { className: 'dspl-banner warn' }, `${t('relayError')}: ${relay.error}`)
          : null,
        autoReply && self.autoError
          ? h('div', { className: 'dspl-banner warn' }, `${t('autoReplyFailed')}: ${self.autoError}`)
          : null,
        h('div', { className: 'dspl-body' },
          h('aside', { className: 'dspl-side' },
            h('div', { className: 'dspl-search' },
              h(Icon, { path: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M16 16l4.5 4.5', size: 15 }),
              h('input', {
                value: query,
                onChange: (event) => setQuery(event.target.value),
                placeholder: t('search'),
                'aria-label': t('search'),
              }),
            ),
            h('div', { className: 'dspl-peerlist' },
              filtered.length === 0
                ? h('div', { className: 'dspl-side-empty' },
                  h('strong', null, query ? t('noMatches') : t('noPeers')),
                  query ? null : h('p', null, t('noPeersHint')),
                  !query && !self.lan ? h('p', { className: 'dspl-muted' }, t('noPeersLanOff')) : null,
                )
                : filtered.map((peer) => h(PeerRow, {
                  key: peer.id,
                  peer,
                  selected: peer.id === selectedId,
                  t,
                  onSelect,
                })),
            ),
            offlinePeers.length > 0
              ? h('button', {
                type: 'button',
                className: 'dspl-clean-offline',
                onClick: onCleanOffline,
                disabled: busy || !state.ready,
                title: t('cleanOfflineConfirm', { n: offlinePeers.length }),
              },
                h(Icon, { path: 'M4 7h16 M9 7V5h6v2 M7 7l1 14h8l1-14', size: 14 }),
                h('span', null, `${t('cleanOffline')} (${offlinePeers.length})`),
              )
              : null,
            h(SelfCard, { state, t, onCopy, copied }),
          ),
          selected
            ? h(Conversation, {
              peer: selected,
              messages,
              state,
              t,
              onSend: sendMessage,
              onMarkRead: (peer) => markRead(peer.id),
            })
            : h(EmptyState, { state, t }),
        ),
      );
    }

    const CSS = `
.dspl-root{height:100%;min-height:420px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;overflow:hidden}
.dspl-root *{box-sizing:border-box}
.dspl-center{align-items:center;justify-content:center;gap:12px;text-align:center;padding:32px}
.dspl-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px 10px}
.dspl-head-main{display:flex;align-items:center;gap:12px;min-width:0}
.dspl-brand{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#5B8CFF,#3B5BDB);box-shadow:0 6px 18px rgba(59,91,219,.24);flex:none}
.dspl-head h1{margin:0;font-size:18px;line-height:1.2;font-weight:650;letter-spacing:-.01em}
.dspl-head-actions{display:flex;align-items:center;gap:8px}
.dspl-ghost{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dspl-ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dspl-ghost.active{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary)}
.dspl-ghost:disabled{opacity:.45;cursor:default}
.dspl-ghost.busy svg{animation:dspl-spin 1s linear infinite}
.dspl-chips{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:0 24px 12px}
.dspl-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dspl-chip.good{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent)}
.dspl-chip.warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,transparent)}
.dspl-chip.muted{color:var(--dsw-alias-label-secondary);opacity:.85}
.dspl-chip-sub{opacity:.7;font-variant-numeric:tabular-nums}
.dspl-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
.dspl-dot.good{background:var(--dsw-alias-state-success-primary)}
.dspl-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.dspl-banner{display:flex;gap:8px;align-items:baseline;margin:0 24px 10px;padding:8px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dspl-banner strong{font-weight:650;color:var(--dsw-alias-label-primary);flex:none}
.dspl-banner.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,var(--dsw-alias-bg-layer-1))}
.dspl-banner.bad{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,var(--dsw-alias-bg-layer-1))}
.dspl-body{display:grid;grid-template-columns:286px minmax(0,1fr);flex:1;min-height:0;border-top:1px solid var(--dsw-alias-border-l1)}
.dspl-side{display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l1)}
.dspl-search{display:flex;align-items:center;gap:8px;margin:12px 12px 8px;padding:0 10px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}
.dspl-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px}
.dspl-search input::placeholder{color:var(--dsw-alias-label-secondary)}
.dspl-peerlist{flex:1;min-height:0;overflow:auto;padding:2px 8px 8px}
.dspl-peer{display:flex;align-items:center;gap:10px;width:100%;padding:9px 8px;border:0;border-radius:9px;background:transparent;color:inherit;text-align:left;cursor:pointer;position:relative}
.dspl-peer:hover{background:var(--dsw-alias-bg-layer-2)}
.dspl-peer.selected{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1))}
.dspl-peer.selected::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--dsw-alias-brand-primary)}
.dspl-avatar{display:grid;place-items:center;border-radius:10px;color:#fff;font-weight:650;letter-spacing:.02em;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.dspl-peer-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dspl-peer-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dspl-peer-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dspl-peer-time{font-size:10px;color:var(--dsw-alias-label-secondary);flex:none;font-variant-numeric:tabular-nums}
.dspl-peer-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dspl-peer-preview{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dspl-clean-offline{display:flex;align-items:center;justify-content:center;gap:6px;margin:0 12px 6px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dspl-clean-offline:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dspl-clean-offline:disabled{opacity:.5;cursor:default}
.dspl-badge{min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:10px;font-weight:650;display:grid;place-items:center;flex:none}
.dspl-presence{position:absolute;right:7px;bottom:7px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1)}
.dspl-presence.online{background:var(--dsw-alias-state-success-primary)}
.dspl-presence.warn{background:var(--dsw-alias-state-warn-primary)}
.dspl-side-empty{padding:18px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;margin:8px 4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
.dspl-side-empty strong{display:block;color:var(--dsw-alias-label-primary);font-size:13px;margin-bottom:5px}
.dspl-side-empty p{margin:6px 0 0}
.dspl-self{border-top:1px solid var(--dsw-alias-border-l1);padding:9px 14px 10px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,transparent))}
.dspl-self-toggle{display:flex;align-items:center;gap:7px;width:100%;min-width:0;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dspl-self-toggle svg{flex:none;color:var(--dsw-alias-label-secondary)}
.dspl-self-toggle:hover .dspl-self-name{color:var(--dsw-alias-brand-primary)}
.dspl-self-label{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--dsw-alias-label-secondary);flex:none}
.dspl-self-name{flex:1;min-width:0;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dspl-self-body{padding-top:7px;display:flex;flex-direction:column;gap:2px}
.dspl-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dspl-muted{color:var(--dsw-alias-label-secondary)}
.dspl-linkbtn{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:11px;cursor:pointer}
.dspl-linkbtn:hover{text-decoration:underline}
.dspl-chat{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dsw-alias-bg-base)}
.dspl-chat-head{display:flex;align-items:center;gap:11px;padding:12px 20px;border-bottom:1px solid var(--dsw-alias-border-l1);min-height:60px}
.dspl-chat-title{min-width:0;flex:1}
.dspl-chat-title h2{margin:0;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dspl-chat-title p{margin:2px 0 0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dspl-chat-head .dspl-ghost{height:26px;font-size:11px}
.dspl-messages{flex:1;min-height:0;overflow:auto;padding:18px 22px 10px;display:flex;flex-direction:column;gap:4px}
.dspl-day{align-self:center;margin:10px 0 8px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10px}
.dspl-msg{display:flex;flex-direction:column;max-width:min(76%,620px);margin:2px 0}
.dspl-msg.out{align-self:flex-end;align-items:flex-end}
.dspl-msg.in{align-self:flex-start;align-items:flex-start}
.dspl-bubble{padding:8px 11px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.dspl-msg.in .dspl-bubble{border-bottom-left-radius:4px}
.dspl-msg.out .dspl-bubble{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base);border-bottom-right-radius:4px}
.dspl-msg.out .dspl-bubble.failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent)}
.dspl-meta{display:flex;gap:6px;align-items:center;margin-top:3px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.dspl-state{opacity:.9}
.dspl-auto{padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600;font-size:9px;letter-spacing:.03em}
.dspl-state.bad{color:var(--dsw-alias-state-error-primary)}
.dspl-chat-empty{margin:auto;color:var(--dsw-alias-label-secondary);font-size:12px}
.dspl-composer{padding:10px 20px 14px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.dspl-composer>.dspl-banner{margin:0 0 8px}
.dspl-composer-box{display:flex;align-items:flex-end;gap:8px;padding:7px 8px 7px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s}
.dspl-composer-box:focus-within{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l2))}
.dspl-composer textarea{flex:1;min-width:0;min-height:26px;max-height:148px;padding:3px 0;border:0;outline:0;resize:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}
.dspl-composer textarea::placeholder{color:var(--dsw-alias-label-secondary)}
.dspl-composer textarea:disabled{opacity:.55}
.dspl-send{width:32px;height:32px;border:0;border-radius:9px;display:grid;place-items:center;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);cursor:pointer;flex:none}
.dspl-send:disabled{opacity:.4;cursor:default}
.dspl-composer-foot{display:flex;justify-content:space-between;gap:10px;margin:5px 3px 0;font-size:10px;color:var(--dsw-alias-label-secondary)}
.dspl-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:36px;min-height:0;overflow:auto}
.dspl-empty-mark{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1));border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,var(--dsw-alias-border-l1));margin-bottom:14px}
.dspl-empty h2{margin:0 0 6px;font-size:19px;font-weight:650;letter-spacing:-.01em}
.dspl-empty-hint{max-width:440px;margin:0 0 14px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.6}
.dspl-steps{text-align:left;margin:0 0 16px;padding:0;list-style:none;counter-reset:dspl-step;display:flex;flex-direction:column;gap:7px;max-width:440px}
.dspl-steps li{counter-increment:dspl-step;display:flex;gap:9px;align-items:baseline;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dspl-steps li::before{content:counter(dspl-step);width:17px;height:17px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:10px;color:var(--dsw-alias-label-primary)}
.dspl-note{max-width:460px;margin:0;padding:8px 11px;border-radius:8px;border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.55}
.dspl-primary{height:32px;padding:0 14px;border:0;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;cursor:pointer}
.dspl-spinner{width:15px;height:15px;border:2px solid color-mix(in srgb,currentColor 30%,transparent);border-top-color:currentColor;border-radius:50%;animation:dspl-spin .8s linear infinite;display:inline-block}
.dspl-spinner.large{width:24px;height:24px}
.dspl-settings{display:flex;flex-direction:column;gap:18px;width:100%;max-width:none;padding:6px 0 24px}
.dspl-settings-title h2{margin:0;font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-.01em}
.dspl-settings-loading{flex-direction:row;align-items:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.dspl-settings-intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.6}
.dspl-settings-section{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dspl-settings-section > .dspl-input,
.dspl-settings-section > .dspl-field{max-width:560px}
.dspl-settings-section > .dspl-textarea{max-width:760px}
.dspl-settings-section > .dspl-grid{max-width:640px}
.dspl-settings-section .dspl-field > select.dspl-input{max-width:640px}
.dspl-settings-section input[type="number"]{max-width:140px}
.dspl-settings-section h3{margin:0;font-size:12.5px;font-weight:650;color:var(--dsw-alias-label-primary)}
.dspl-settings-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.dspl-settings-actions{display:flex;justify-content:flex-end;gap:8px;position:static;padding:8px 0 0;border-top:1px solid var(--dsw-alias-border-l1);background:transparent}
.dspl-settings-actions .dspl-primary{height:34px;min-width:84px}
.dspl-input{width:100%;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.2;outline:0;box-sizing:border-box}
.dspl-input:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1))}
.dspl-input::placeholder{color:var(--dsw-alias-label-secondary)}
.dspl-textarea{height:auto;min-height:84px;padding:8px 10px;resize:vertical;line-height:1.5}
.dspl-grid{display:grid;gap:10px}
.dspl-grid.three{grid-template-columns:minmax(0,1fr) 140px 140px;max-width:640px}
.dspl-field{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.dspl-field-gap{margin-top:4px}
.dspl-checks{display:flex;flex-wrap:wrap;gap:8px 16px}
.dspl-check{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}
.dspl-check input{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary)}
.dspl-banner.good{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,var(--dsw-alias-bg-layer-1))}
.dspl-navicon{position:relative;display:inline-grid;place-items:center;color:currentColor}
.dspl-navicon.active{color:var(--dsw-alias-brand-primary)}
.dspl-navdot{position:absolute;right:-1px;top:-1px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1)}
@keyframes dspl-spin{to{transform:rotate(360deg)}}
@media (max-width:820px){
  .dspl-body{grid-template-columns:232px minmax(0,1fr)}
  .dspl-head{padding:14px 16px 8px}
  .dspl-chips{padding:0 16px 10px}
  .dspl-messages{padding:14px 14px 8px}
  .dspl-composer{padding:8px 14px 12px}
}
@media (max-width:620px){
  .dspl-body{grid-template-columns:1fr;grid-template-rows:minmax(120px,34%) minmax(0,1fr)}
  .dspl-side{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}
  .dspl-self{display:none}
  .dspl-grid.three{grid-template-columns:1fr}
}
`;

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'peer-link: locale');
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          const style = document.createElement('style');
          style.setAttribute('data-dsh-peer-link-style', '1');
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'peer-link: styles');
        ctx.effect(() => start(), 'peer-link: client state');

        const navLabel = () => {
          const active = ctx.locale?.getLocale?.().active ?? '';
          return active.startsWith('zh') ? '实例互传' : 'Peer Link';
        };
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'peer-link',
          order: 12,
          label: navLabel,
        }, (props) => h(PeerIcon, { size: props?.size ?? 17, active: Boolean(props?.active) })));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'peer-link',
        }, (props) => h(PeerPanel, { ctx })));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'peer-link',
          order: 18,
          label: navLabel,
          locale: NS,
        }, () => h(PeerSettingsPanel, { ctx, showHeader: true })));
      },
    };
  },
});
