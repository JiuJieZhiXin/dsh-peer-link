/**
 * Peer Link Host plugin.
 *
 * Owns:
 *  - same-account identity and the local cluster key,
 *  - discovery and delivery through `PeerLinkNode`,
 *  - three model-facing tools,
 *  - the same-origin Web API used by the Client panel.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';
import { PeerLinkNode } from './lib/node.js';
import {
  PROTOCOL,
  VERSION,
  deriveKey,
  isLoopback,
  keyFingerprint,
  safeEqualText,
  sha256,
  truncate,
} from './lib/protocol.js';
import { registerPeerTools } from './lib/tools.js';

export const name = 'peer-link';

export const Config = z.object({
  name: z.string().default('').description('Display name for this Harness instance.'),
  transports: z.array(z.union([
    z.const('local').description('Discover other instances on this machine.'),
    z.const('lan').description('Discover instances on the local network with UDP multicast.'),
    z.const('manual').description('Use the manualPeers list (VPN, port forwarding, or fixed addresses).'),
    z.const('relay').description('Use a WebSocket relay such as the bundled Cloudflare Worker.'),
  ])).default(['local']).description('Connection methods to enable.'),
  listenHost: z.string().default('').description('Peer listen address. Empty = 127.0.0.1, or 0.0.0.0 when LAN is enabled.'),
  listenPort: z.number().min(0).max(65_535).default(0).description('Peer TCP port. 0 = random. Fix it for port forwarding or firewalls.'),
  udpPort: z.number().min(1).max(65_535).default(45_872).description('UDP multicast port used by the LAN transport.'),
  manualPeers: z.array(z.string()).default([]).description('Manual peer origins, for example http://192.168.1.20:45873.'),
  sharedSecret: z.string().role('secret').default('').description('Pairing passphrase. Use the same value on every machine that should connect.'),
  relayUrl: z.string().default('').description('WebSocket relay URL, for example wss://dsh-peer-relay.example.workers.dev/peer.'),
  relayToken: z.string().role('secret').default('').description('Access token configured as RELAY_TOKEN on the relay Worker.'),
  requireSameAccount: z.boolean().default(true).description('Reject instances signed in to another DeepSeek account.'),
  autoReply: z.boolean().default(false).description('Let the local agent answer incoming Peer Link messages automatically.'),
  autoReplySession: z.string().default('').description('Specific live agent/session id to take over; empty means automatic selection.'),
  maxMessages: z.number().min(50).max(2000).default(300).description('Messages retained per conversation.'),
  lan: z.boolean().default(false).hidden(),
});

const WEB_BASE = '/_peer-link/v1';
const SSE_HEARTBEAT_MS = 20_000;
const ACCOUNT_REFRESH_MS = 5 * 60_000;
const MAX_UI_BODY = 64 * 1024;

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const logger = makeLogger(ctx);
  const service = new PeerLinkService(ctx, config, logger);

  ctx.effect(() => {
    void service.start().catch((error) => {
      logger.warn?.(`[peer-link] start failed: ${error?.message ?? error}`);
    });
    return () => {
      void service.stop();
    };
  }, 'peer-link: lifecycle');

  ctx.inject(['tools'], (child) => {
    child.effect(() => service.registerTools(child.tools), 'peer-link: tools');
  });

  ctx.inject(['webServer'], (child) => {
    child.effect(() => service.registerWeb(child.webServer), 'peer-link: web');
  });
}

class PeerLinkService {
  constructor(ctx, config, logger) {
    this.ctx = ctx;
    this.baseConfig = config;
    this.config = config;
    this.storedSettings = {};
    this.settingsRevision = Date.now();
    this.logger = logger;
    this.profileName = process.env.DSH_PROFILE || 'desktop';
    this.baseDir = path.join(resolveDshHome(), 'peer-link');
    this.registryDir = path.join(this.baseDir, 'instances');
    this.stateKey = profileStateKey(this.profileName);
    this.stateDir = path.join(this.baseDir, 'state', this.stateKey);
    this.key = null;
    this.instanceId = '';
    this.account = { signedIn: false, scope: 'local:unknown', label: 'Local account' };
    this.name = config.name || os.hostname();
    this.node = null;
    this.startPromise = null;
    this.startError = null;
    this.stopped = false;
    this.accountTimer = null;
    this.accountWatchController = null;
    this.autoReplyTurns = new Map();
    this.autoReplyCounts = new Map();
    this.directReplies = new Set();
    this.autoError = null;
    this.webToken = null;
    this.webServer = null;
    this.webDispose = null;
    this.sseClients = new Set();
    this.sseHeartbeat = null;
    this.broadcastTimer = null;
  }

  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().catch(async (error) => {
      this.startError = truncate(error?.message ?? String(error), 400);
      this.logger.warn?.(`[peer-link] ${this.startError}`);
      await this.stop().catch(() => {});
      throw error;
    });
    return this.startPromise;
  }

  async startInternal() {
    if (this.stopped) throw new Error('Peer Link has already stopped');
    await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.stateDir, 0o700).catch(() => {});
    this.storedSettings = await loadStoredSettings(this.stateDir);
    this.config = normalizeConfig({ ...this.baseConfig, ...this.storedSettings });
    const secret = await loadSecret(this.baseDir);
    this.key = deriveKey(secret, this.config.sharedSecret);
    this.account = await this.resolveAccount();
    this.instanceId = await loadInstanceId(this.stateDir, this.registryDir, this.profileName);
    await this.createNode();

    this.accountTimer = setInterval(() => {
      void this.refreshAccount();
    }, ACCOUNT_REFRESH_MS);
    this.accountTimer.unref?.();
    void this.watchAccount();

    this.logger.info?.(
      `[peer-link] ready: ${this.name} (${this.account.label}), ${this.account.signedIn ? 'same-account' : 'local'} mode`,
    );
    return this;
  }

  async createNode() {
    this.name = this.config.name || os.hostname();
    this.node = new PeerLinkNode({
      stateDir: this.stateDir,
      registryDir: this.registryDir,
      instanceId: this.instanceId,
      key: this.key,
      name: this.name,
      profileName: this.profileName,
      account: this.account,
      config: this.config,
      logger: this.logger,
    });
    this.node.on('change', () => this.broadcast());
    this.node.on('inbound', (event) => {
      void this.onInbound(event);
    });
    await this.node.start();
    this.startError = null;
  }

  async onInbound(event) {
    if (!event || !this.config.autoReply || event.message?.auto === true) return;
    const peerId = event.peerId;
    const now = Date.now();
    const turns = (this.autoReplyCounts.get(peerId) ?? []).filter((at) => now - at < 10 * 60_000);
    if (turns.length >= 6) {
      this.logger.warn?.('[peer-link] auto-reply rate limit reached for this peer');
      return;
    }
    turns.push(now);
    this.autoReplyCounts.set(peerId, turns);

    const agents = this.ctx.get('agents');
    const roots = typeof agents?.roots === 'function' ? agents.roots() : [];
    // A configured session wins even when several agents are live. Otherwise a
    // single live session is unambiguous; zero or several fall back to the
    // configured default model.
    let selected = null;
    if (this.config.autoReplySession && typeof agents?.get === 'function') {
      try {
        selected = agents.get(this.config.autoReplySession) ?? null;
      } catch {
        selected = null;
      }
    }
    const agent = selected && typeof selected.followup === 'function'
      ? selected
      : roots.length === 1 && typeof roots[0]?.followup === 'function' ? roots[0] : null;
    if (!agent) {
      await this.directReply(event);
      return;
    }
    try {
      const peer = this.node?.peers.get(peerId);
      const peerName = peer?.name || event.peer?.name || peerId.slice(0, 8);
      const text = event.message?.text ?? '';
      this.autoReplyTurns.set(peerId, {
        agentId: agent.id,
        expires: now + 3 * 60_000,
      });
      const prompt = [
        '[Peer Link 自动接管]',
        `对端实例 "${peerName}"（id: ${peerId}）发来一条消息：`,
        '---',
        text,
        '---',
        `如果这条消息需要回复，请调用 peer_link_send 工具，peer 参数使用 id "${peerId}"。只发送一条回复，然后结束本轮。`,
        '不要用普通聊天消息回复，因为对端看不到；也不要把这条消息当成用户在本机对你说的。',
      ].join('\n');
      // The agent inbox consumes a complete, already-identified user message.
      // Passing only { content, source } is accepted by the inbox splice, but
      // the next step then commits an anonymous user/message that fails
      // session validation and every later model request ("missing field role").
      await Promise.resolve(agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      }));
      this.autoError = null;
      this.logger.info?.(`[peer-link] auto-reply turn started for ${peerName}`);
    } catch (error) {
      this.autoReplyTurns.delete(peerId);
      this.logger.warn?.(`[peer-link] agent auto-reply failed, falling back to the default model: ${error?.message ?? error}`);
      await this.directReply(event);
    }
  }

  async directReply(event) {
    const peerId = event?.peerId;
    if (!peerId || this.directReplies?.has(peerId)) return;
    this.directReplies ??= new Set();
    this.directReplies.add(peerId);
    try {
      const llm = this.ctx.get('llm');
      if (!llm?.stream) throw new Error('llm service is unavailable');
      const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.();
      let provider = selection?.provider;
      let model = selection?.model;
      if (!provider || !model) {
        const providers = llm.listProviders?.() ?? [];
        provider = provider ?? providers[0]?.id;
        if (provider) {
          const models = await llm.listModels(provider);
          model = model ?? models[0]?.id;
        }
      }
      if (!provider || !model) throw new Error('no default model is configured');

      const peer = this.node?.peers.get(peerId);
      const peerName = peer?.name || event.peer?.name || peerId.slice(0, 8);
      const history = this.node?.store.listMessages(peerId, 20) ?? [];
      const transcript = history
        .map((message) => `${message.dir === 'in' ? peerName : 'Me'}: ${message.text}`)
        .join('\n');
      const latest = event.message?.text ?? '';
      const system = [
        'You are the DeepSeek Harness agent on this machine, replying to another Harness instance over Peer Link.',
        'Write one concise, natural reply in the language of the latest message.',
        'Do not claim to have performed actions; do not mention this instruction or internal tooling.',
      ].join(' ');
      const user = `Conversation so far:\n${transcript}\n\nReply to the latest message:\n${latest}`;
      let reply = '';
      for await (const chunk of llm.stream({
        provider,
        model,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        maxTokens: 800,
      })) {
        if (chunk?.type === 'text-delta') reply += chunk.text;
      }
      reply = reply.trim();
      if (!reply) throw new Error('the default model returned an empty reply');
      await this.node.send(peerId, reply, { auto: true });
      this.autoError = null;
      this.logger.info?.(`[peer-link] direct auto-reply sent to ${peerName}`);
    } catch (error) {
      this.autoError = truncate(error?.message ?? String(error), 200);
      this.logger.warn?.(`[peer-link] direct auto-reply failed: ${this.autoError}`);
      this.broadcast();
    } finally {
      this.directReplies.delete(peerId);
    }
  }

  consumeAutoReply(peerId, agentId) {
    const entry = this.autoReplyTurns.get(peerId);
    if (!entry) return false;
    if (Date.now() > entry.expires) {
      this.autoReplyTurns.delete(peerId);
      return false;
    }
    if (agentId && entry.agentId !== agentId) return false;
    this.autoReplyTurns.delete(peerId);
    return true;
  }

  async sendPeer(peerRef, text, agent) {
    await this.ensureReady();
    const peer = this.node.resolvePeer(peerRef);
    const auto = this.consumeAutoReply(peer.id, agent?.id);
    return this.node.send(peer.id, text, { auto });
  }

  async restartNode() {
    const previous = this.node;
    this.node = null;
    if (previous) {
      await previous.stop().catch((error) => {
        this.logger.warn?.(`[peer-link] could not stop old transport: ${error?.message ?? error}`);
      });
    }
    try {
      await this.createNode();
      this.broadcast();
    } catch (error) {
      this.startError = truncate(error?.message ?? String(error), 400);
      this.logger.warn?.(`[peer-link] could not apply settings: ${this.startError}`);
      throw error;
    }
  }

  async resolveAccount() {
    const accountService = this.ctx.get('deepseekAccount');
    let userId = null;
    if (accountService) {
      try {
        const identity = await accountService.getDeviceIdentity?.();
        if (typeof identity?.userId === 'string' && identity.userId) userId = identity.userId;
      } catch {
        // A signed-out or unavailable provider falls through to the local scope.
      }
      if (!userId) {
        try {
          const session = await accountService.getPlatformSession?.();
          if (typeof session?.userId === 'string' && session.userId) userId = session.userId;
        } catch {
          // Ignore: the local scope still permits same-machine instances.
        }
      }
    }
    const signedIn = Boolean(userId);
    const scope = signedIn
      ? sha256(`dsh-peer-link:account:${userId}`)
      : sha256(`dsh-peer-link:local:${os.userInfo().username}@${os.hostname()}`);
    const short = signedIn ? String(userId).slice(-4) : os.userInfo().username.slice(0, 16);
    return {
      signedIn,
      scope,
      label: signedIn ? `DeepSeek · ${short}` : `Local · ${short}`,
    };
  }

  async refreshAccount() {
    if (this.stopped || !this.node) return;
    try {
      const next = await this.resolveAccount();
      this.account = next;
      this.node.updateAccount(next);
    } catch (error) {
      this.logger.warn?.(`[peer-link] account refresh failed: ${error?.message ?? error}`);
    }
  }

  async watchAccount() {
    const accountService = this.ctx.get('deepseekAccount');
    if (!accountService?.watch || this.accountWatchController) return;
    const controller = new AbortController();
    this.accountWatchController = controller;
    try {
      for await (const _snapshot of accountService.watch(controller.signal, true)) {
        if (this.stopped) break;
        await this.refreshAccount();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.logger.warn?.(`[peer-link] account watch stopped: ${error?.message ?? error}`);
      }
    } finally {
      if (this.accountWatchController === controller) this.accountWatchController = null;
    }
  }

  async ensureReady() {
    if (this.startError) throw new Error(this.startError);
    if (!this.startPromise) throw new Error('Peer Link is not initialized');
    await this.startPromise;
    if (!this.node) throw new Error('Peer Link transport is unavailable');
  }

  registerTools(tools) {
    return registerPeerTools(this, tools);
  }

  registerWeb(webServer) {
    if (this.webDispose || this.stopped) return () => {};
    // Keep the page token stable across plugin reloads. A live page otherwise
    // keeps the token from its last index load and every request 401s until a
    // manual refresh.
    this.webToken = loadWebTokenSync(this.stateDir);
    this.webServer = webServer;
    const token = this.webToken;
    const tapDispose = webServer.tapIndex((html) => injectToken(html, token));
    const routeDispose = webServer.register({
      kind: 'prefix',
      path: WEB_BASE,
      handler: (req, res) => {
        void this.handleWeb(req, res);
      },
    });
    this.sseHeartbeat = setInterval(() => {
      for (const client of this.sseClients) {
        try {
          client.write(': ping\n\n');
        } catch {
          this.sseClients.delete(client);
        }
      }
    }, SSE_HEARTBEAT_MS);
    this.sseHeartbeat.unref?.();

    this.webDispose = () => {
      if (this.sseHeartbeat) clearInterval(this.sseHeartbeat);
      this.sseHeartbeat = null;
      for (const client of this.sseClients) {
        try {
          client.end();
        } catch {
          // already closed
        }
      }
      this.sseClients.clear();
      routeDispose?.();
      tapDispose?.();
      this.webDispose = null;
    };
    return () => this.webDispose?.();
  }

  configValue() {
    return {
      name: this.config.name,
      transports: this.config.transports,
      listenHost: this.config.listenHost,
      listenPort: this.config.listenPort,
      udpPort: this.config.udpPort,
      manualPeers: [...this.config.manualPeers],
      relayUrl: this.config.relayUrl,
      requireSameAccount: this.config.requireSameAccount,
      autoReply: this.config.autoReply,
      autoReplySession: this.config.autoReplySession,
      maxMessages: this.config.maxMessages,
    };
  }

  configSecrets() {
    return [
      { path: ['sharedSecret'], set: Boolean(this.config.sharedSecret) },
      { path: ['relayToken'], set: Boolean(this.config.relayToken) },
    ];
  }

  async saveSettings(patch) {
    const nextStored = { ...this.storedSettings, ...patch };
    await writeStoredSettings(this.stateDir, nextStored);
    this.storedSettings = nextStored;
    this.settingsRevision = Date.now();
    const next = normalizeConfig({ ...this.baseConfig, ...nextStored });
    const nodeKeys = [
      'name', 'transports', 'listenHost', 'listenPort', 'udpPort', 'manualPeers',
      'sharedSecret', 'relayUrl', 'relayToken', 'requireSameAccount', 'maxMessages',
    ];
    const changed = nodeKeys.some((key) => JSON.stringify(next[key]) !== JSON.stringify(this.config[key]));
    this.config = next;
    const previousKey = this.key;
    const secret = await loadSecret(this.baseDir);
    this.key = deriveKey(secret, next.sharedSecret);
    if (changed || !previousKey || !this.key.equals(previousKey)) {
      await this.restartNode();
    } else {
      this.broadcast();
    }
  }

  async handleWeb(req, res) {
    const url = new URL(req.url ?? '/', 'http://peer-link.invalid');
    if (!this.webTokenValid(req, url)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const pathname = url.pathname;
    try {
      if (req.method === 'GET' && pathname === `${WEB_BASE}/state`) {
        sendJson(res, 200, this.getUiState());
        return;
      }
      if (req.method === 'GET' && pathname === `${WEB_BASE}/config`) {
        sendJson(res, 200, {
          ok: true,
          value: this.configValue(),
          secrets: this.configSecrets(),
          revision: this.settingsRevision,
        });
        return;
      }
      if (req.method === 'GET' && pathname === `${WEB_BASE}/agents`) {
        const agents = this.ctx.get('agents');
        const titles = this.ctx.get('sessionTitle');
        const roots = typeof agents?.roots === 'function' ? agents.roots() : [];
        sendJson(res, 200, {
          ok: true,
          autoReply: this.config.autoReply,
          selected: this.config.autoReplySession,
          agents: roots.map((agent) => ({
            id: String(agent.id),
            title: agentTitle(agent, titles),
            status: typeof agent.status === 'string' ? agent.status : '',
          })),
        });
        return;
      }
      if (req.method === 'POST' && pathname === `${WEB_BASE}/config`) {
        const body = await readJsonBody(req, MAX_UI_BODY);
        const patch = normalizeSettingsPatch(body);
        await this.saveSettings(patch);
        sendJson(res, 200, {
          ok: true,
          value: this.configValue(),
          secrets: this.configSecrets(),
          revision: this.settingsRevision,
        });
        return;
      }
      if (req.method === 'GET' && pathname === `${WEB_BASE}/events`) {
        this.openSse(req, res);
        return;
      }
      if (req.method === 'POST' && pathname === `${WEB_BASE}/send`) {
        await this.ensureReady();
        const body = await readJsonBody(req, MAX_UI_BODY);
        const result = await this.node.send(body.peer, body.text);
        sendJson(res, 200, { ok: true, result });
        return;
      }
      if (req.method === 'POST' && pathname === `${WEB_BASE}/read`) {
        await this.ensureReady();
        const body = await readJsonBody(req, MAX_UI_BODY);
        sendJson(res, 200, this.node.markRead(body.peer));
        return;
      }
      if (req.method === 'POST' && pathname === `${WEB_BASE}/forget`) {
        await this.ensureReady();
        const body = await readJsonBody(req, MAX_UI_BODY);
        sendJson(res, 200, this.node.forgetPeer(body.peer));
        return;
      }
      if (req.method === 'POST' && pathname === `${WEB_BASE}/refresh`) {
        if (this.node) {
          void this.node.scanRegistry();
          void this.node.probeManualPeers();
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && pathname === `${WEB_BASE}/identity`) {
        await this.ensureReady();
        const state = this.node.getState();
        sendJson(res, 200, {
          ok: true,
          self: state.self,
          shareText: [
            `Peer Link: ${state.self.name}`,
            `instance: ${state.self.instanceId}`,
            `endpoint: ${state.self.endpoint}`,
            `key: ${state.self.keyFingerprint}`,
            `account: ${state.self.account.label}`,
          ].join('\n'),
        });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 400;
      sendJson(res, status, { ok: false, error: truncate(error?.message ?? String(error), 300) });
    }
  }

  webTokenValid(req, url) {
    if (this.webToken) {
      const header = req.headers['x-peer-link-token'];
      const headerValue = Array.isArray(header) ? header[0] : header;
      if (headerValue && safeEqualText(headerValue, this.webToken)) return true;
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.dsh_peer_link && safeEqualText(cookies.dsh_peer_link, this.webToken)) return true;
      const query = url.searchParams.get('token');
      if (query && safeEqualText(query, this.webToken)) return true;
    }

    // The injected token is the primary credential. A same-origin request from
    // the loopback Web carrier is also safe: the browser cannot read another
    // origin's response, and mutating routes require a JSON body. This also
    // keeps the panel usable when a Desktop reload serves a cached index whose
    // injected token predates a plugin restart.
    const remote = req.socket?.remoteAddress;
    if (!isLoopback(remote)) return false;
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return true;
    try {
      const parsed = new URL(origin);
      if (!isLoopback(parsed.hostname)) return false;
      if (this.webServer) {
        const serverOrigin = new URL(this.webServer.getOrigin());
        if (parsed.port !== serverOrigin.port) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  openSse(_req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.sseClients.add(res);
    res.on('close', () => {
      this.sseClients.delete(res);
    });
    this.pushSseState(res);
  }

  pushSseState(client) {
    try {
      const payload = JSON.stringify(this.getUiState());
      client.write(`event: state\ndata: ${payload}\n\n`);
    } catch {
      this.sseClients.delete(client);
    }
  }

  broadcast() {
    if (this.stopped || this.broadcastTimer || this.sseClients.size === 0) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      if (this.stopped) return;
      const payload = JSON.stringify(this.getUiState());
      for (const client of this.sseClients) {
        try {
          if (client.writableLength > 2 * 1024 * 1024) {
            client.destroy();
            this.sseClients.delete(client);
            continue;
          }
          client.write(`event: state\ndata: ${payload}\n\n`);
        } catch {
          this.sseClients.delete(client);
        }
      }
    }, 80);
    this.broadcastTimer.unref?.();
  }

  getUiState() {
    if (!this.node) {
      return {
        ready: false,
        status: this.startError ? 'error' : 'starting',
        error: this.startError,
        protocol: PROTOCOL,
        version: VERSION,
        self: {
          instanceId: '',
          name: this.name,
          profile: this.profileName,
          account: { signedIn: false, label: '' },
          port: 0,
          endpoint: '',
          lan: this.config.lan,
          lanAddresses: [],
          keyFingerprint: this.key ? keyFingerprint(this.key) : '',
          transports: this.config.transports,
          relay: { enabled: this.config.relay, connected: false, error: null },
          autoReply: this.config.autoReply,
          autoReplySession: this.config.autoReplySession,
          autoError: this.autoError,
          agentCount: 0,
          startedAt: Date.now(),
        },
        peers: [],
        conversations: {},
        presets: {
          transports: this.config.transports,
          manualPeers: this.config.manualPeers,
          listenPort: this.config.listenPort,
          lan: this.config.lan,
          relayUrl: this.config.relayUrl,
          requireSameAccount: this.config.requireSameAccount,
          autoReply: this.config.autoReply,
          autoReplySession: this.config.autoReplySession,
        },
        stats: { online: 0, known: 0, unread: 0, mismatched: 0 },
        errors: { lan: null, manual: null, last: this.startError },
      };
    }
    const state = this.node.getState();
    const agentCount = this.ctx.get('agents')?.roots?.().length ?? 0;
    return {
      ...state,
      self: {
        ...state.self,
        // The Node's self snapshot is captured at construction; autoReply and
        // its selected session can change live without a transport restart.
        autoReply: this.config.autoReply,
        autoReplySession: this.config.autoReplySession,
        agentCount,
        autoError: this.autoError,
      },
      status: 'ready',
    };
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.accountTimer) clearInterval(this.accountTimer);
    this.accountTimer = null;
    if (this.accountWatchController) {
      this.accountWatchController.abort();
      this.accountWatchController = null;
    }
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.broadcastTimer = null;
    this.webDispose?.();
    this.webDispose = null;
    if (this.node) {
      const node = this.node;
      this.node = null;
      await node.stop().catch((error) => {
        this.logger.warn?.(`[peer-link] stop failed: ${error?.message ?? error}`);
      });
    }
  }
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const requested = Array.isArray(input.transports)
    ? input.transports.filter((value) => typeof value === 'string')
    : null;
  const legacy = [];
  if (input.lan === true) legacy.push('lan');
  if (Array.isArray(input.manualPeers) && input.manualPeers.length > 0) legacy.push('manual');
  if (typeof input.relayUrl === 'string' && input.relayUrl.trim()) legacy.push('relay');
  const transports = [...new Set((requested ?? ['local', ...legacy])
    .filter((value) => ['local', 'lan', 'manual', 'relay'].includes(value)))];
  if (transports.length === 0) transports.push('local');
  // Compatibility with the first version, where `lan: true` was the switch.
  if (input.lan === true && !transports.includes('lan')) transports.push('lan');
  const lan = transports.includes('lan');
  const listenHost = typeof input.listenHost === 'string' && input.listenHost.trim()
    ? input.listenHost.trim()
    : (lan ? '0.0.0.0' : '127.0.0.1');
  const listenPort = Number.isInteger(input.listenPort) && input.listenPort >= 0 && input.listenPort <= 65_535
    ? input.listenPort
    : 0;
  const udpPort = Number.isInteger(input.udpPort) && input.udpPort > 0 && input.udpPort <= 65_535
    ? input.udpPort
    : 45_872;
  const manualPeers = Array.isArray(input.manualPeers)
    ? input.manualPeers.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
  const maxMessages = Number.isInteger(input.maxMessages) && input.maxMessages > 0
    ? Math.min(input.maxMessages, 2000)
    : 300;
  const relayUrl = typeof input.relayUrl === 'string' ? input.relayUrl.trim() : '';
  return {
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : '',
    transports,
    local: transports.includes('local'),
    lan,
    manual: transports.includes('manual'),
    relay: transports.includes('relay'),
    relayUrl,
    relayToken: typeof input.relayToken === 'string' ? input.relayToken : '',
    listenHost,
    listenPort,
    udpPort,
    manualPeers,
    sharedSecret: typeof input.sharedSecret === 'string' ? input.sharedSecret : '',
    requireSameAccount: input.requireSameAccount !== false,
    autoReply: input.autoReply === true,
    autoReplySession: typeof input.autoReplySession === 'string' ? input.autoReplySession.trim() : '',
    maxMessages,
  };
}

const STORED_SETTINGS_FILE = 'settings.json';

async function loadStoredSettings(stateDir) {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(stateDir, STORED_SETTINGS_FILE), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([key]) => SETTINGS_KEYS.has(key)));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      // A corrupt overlay is ignored; the profile Config remains the base.
    }
    return {};
  }
}

async function writeStoredSettings(stateDir, value) {
  const file = path.join(stateDir, STORED_SETTINGS_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, file);
}

async function loadSecret(stateDir) {  const file = path.join(stateDir, 'secret.key');
  try {
    const raw = (await fs.readFile(file, 'utf8')).trim();
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 32) return buffer;
    // A corrupt or truncated key cannot authenticate anything; replace it.
    await fs.rm(file, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      // Permission/IO failures should surface rather than silently regenerate
      // a key that peers already trust.
      throw error;
    }
  }
  const secret = randomBytes(32);
  try {
    await fs.writeFile(file, secret.toString('base64'), { mode: 0o600, flag: 'wx' });
    return secret;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const raw = (await fs.readFile(file, 'utf8')).trim();
      const buffer = Buffer.from(raw, 'base64');
      if (buffer.length === 32) return buffer;
    }
    throw error;
  }
}

const SETTINGS_KEYS = new Set([
  'name', 'transports', 'listenHost', 'listenPort', 'udpPort', 'manualPeers',
  'sharedSecret', 'relayUrl', 'relayToken', 'requireSameAccount', 'autoReply', 'autoReplySession', 'maxMessages',
]);

function normalizeSettingsPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid settings patch');
  const patch = {};
  for (const key of Object.keys(raw)) {
    if (!SETTINGS_KEYS.has(key)) continue;
    const value = raw[key];
    switch (key) {
      case 'name':
        if (typeof value !== 'string') throw new Error('name must be a string');
        patch.name = value.trim().slice(0, 80);
        break;
      case 'transports': {
        if (!Array.isArray(value)) throw new Error('transports must be an array');
        const transports = [...new Set(value.filter((item) => ['local', 'lan', 'manual', 'relay'].includes(item)))];
        if (transports.length === 0) throw new Error('choose at least one transport');
        patch.transports = transports;
        break;
      }
      case 'manualPeers':
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
          throw new Error('manualPeers must be an array of strings');
        }
        patch.manualPeers = value.map((item) => item.trim()).filter(Boolean);
        break;
      case 'listenHost':
      case 'relayUrl':
      case 'autoReplySession':
        if (typeof value !== 'string') throw new Error(`${key} must be a string`);
        patch[key] = value.trim();
        break;
      case 'sharedSecret':
      case 'relayToken':
        if (typeof value !== 'string') throw new Error(`${key} must be a string`);
        patch[key] = value;
        break;
      case 'listenPort':
        if (!Number.isInteger(value) || value < 0 || value > 65_535) throw new Error('listenPort is invalid');
        patch.listenPort = value;
        break;
      case 'udpPort':
        if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error('udpPort is invalid');
        patch.udpPort = value;
        break;
      case 'maxMessages':
        if (!Number.isInteger(value) || value < 50 || value > 2000) throw new Error('maxMessages is invalid');
        patch.maxMessages = value;
        break;
      case 'requireSameAccount':
      case 'autoReply':
        if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
        patch[key] = value;
        break;
      default:
        break;
    }
  }
  if (Object.keys(patch).length === 0) throw new Error('no settings to save');
  return patch;
}

function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.dsh');
}

function profileStateKey(profile) {
  return String(profile || 'default').replace(/[^0-9a-zA-Z._-]/g, '_').slice(0, 80) || 'default';
}

export async function loadInstanceId(stateDir, registryDir, profileName) {
  const file = path.join(stateDir, 'instance-id');
  try {
    const value = (await fs.readFile(file, 'utf8')).trim();
    if (/^[0-9a-f]{16,64}$/i.test(value)) return value;
  } catch {
    // First start after the upgrade: adopt the most recent registry identity
    // for this profile, so a restart reuses its peer row instead of adding one.
  }
  let chosen = '';
  try {
    const names = (await fs.readdir(registryDir)).filter((name) => name.endsWith('.json'));
    const records = [];
    for (const name of names) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(registryDir, name), 'utf8'));
        if (data?.profile !== profileName) continue;
        if (typeof data.instanceId !== 'string' || !/^[0-9a-f]{16,64}$/i.test(data.instanceId)) continue;
        records.push({ id: data.instanceId, at: Number(data.updatedAt) || 0 });
      } catch {
        // Ignore a concurrent/stale registry write.
      }
    }
    records.sort((left, right) => right.at - left.at);
    chosen = records[0]?.id ?? '';
  } catch {
    // Registry is optional; a fresh identity is fine.
  }
  const id = chosen || randomBytes(16).toString('hex');
  await fs.writeFile(file, id, { mode: 0o600 }).catch(() => {});
  return id;
}

function agentTitle(agent, titles) {
  try {
    const snapshot = titles?.get?.(agent?.session);
    const current = typeof snapshot?.title === 'string' ? snapshot.title.trim() : '';
    if (current) return truncate(current, 56);
  } catch {
    // Fall back to session content while a title provider is unavailable.
  }
  const session = agent?.session;
  try {
    const end = Math.min(Number(session?.seq ?? 0) + 1, 200);
    const events = typeof session?.snapshotEvents === 'function'
      ? session.snapshotEvents(0, end)
      : [];
    for (const event of events) {
      if (event?.type !== 'user/message') continue;
      const text = messageText(event.data);
      if (text && !isContextOnlyTitle(text)) return truncate(text, 56);
    }
  } catch {
    // Fall through to project/session metadata.
  }
  const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : '';
  const project = cwd.split(/[\\/]/).filter(Boolean).at(-1) || '';
  const preset = typeof session?.header?.agentPreset === 'string' ? session.header.agentPreset : '';
  if (project) return preset ? `${project} · ${preset}` : project;
  if (preset) return `Session · ${preset}`;
  return `Session ${String(agent?.id ?? '').slice(0, 8)}`;
}

function messageText(message) {
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isContextOnlyTitle(text) {
  return [
    '[Peer Link 自动接管]',
    '<system-reminder>',
    'The approval policy changed',
    'Current runtime context.',
    'Time sampled while preparing',
    'This is an automatically generated checkpoint',
    'The user has approved',
    'This session is being continued',
  ].some((prefix) => text.startsWith(prefix));
}

function loadWebTokenSync(stateDir) {
  const file = path.join(stateDir, 'web-token');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{32,64}$/.test(existing)) return existing;
  } catch {
    // First run, or a missing/unreadable token file.
  }
  const token = randomBytes(18).toString('hex');
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // A read-only state directory still works for this process; the next
    // reload will generate a new token and require a page refresh.
  }
  return token;
}

function makeLogger(ctx) {
  return {
    info: (...args) => ctx.logger?.info?.(...args),
    warn: (...args) => ctx.logger?.warn?.(...args),
    error: (...args) => ctx.logger?.error?.(...args),
  };
}

function injectToken(html, token) {
  if (typeof html !== 'string' || html.includes('data-dsh-peer-link')) return html;
  const script = `<script data-dsh-peer-link="1">window.__DSH_PEER_LINK__=${JSON.stringify({ token, version: VERSION })};try{document.cookie="dsh_peer_link=${token}; path=/; SameSite=Strict";}catch(e){}</script>`;
  if (html.includes('</head>')) return html.replace('</head>', `${script}</head>`);
  return `${html}${script}`;
}

function parseCookies(value) {
  const cookies = {};
  if (typeof value !== 'string') return cookies;
  for (const part of value.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[key] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

async function readJsonBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('request body is too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('invalid JSON body');
    error.status = 400;
    throw error;
  }
}

function sendJson(res, status, value) {
  if (res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}
