# 实例互传 · Peer Link

默认让同一个 DeepSeek 账号下的多个 DeepSeek Harness 实例之间聊天、互发消息；也支持双方共享 `sharedSecret` 后跨账号配对。连接方式是插件设置项，可多选：本机、局域网、手动节点、Cloudflare Worker 中继。默认只开本机回环，不会主动暴露端口。

## 功能

- 左侧栏气泡图标打开「实例互传」面板。
- 四种可选传输：`local`（同机注册表）、`lan`（UDP 组播）、`manual`（手填地址）、`relay`（WebSocket 中继）。
- 一对一聊天：在线状态、未读数、离线排队、失败重试、已读标记。
- 每个 peer 显示实际来源（Local / LAN / Manual / Relay）；中继状态在顶部单独显示。
- 三个模型工具：
  - `peer_link_list`：列出可通信实例。
  - `peer_link_send`：向指定实例发消息。
  - `peer_link_inbox`：读取收到的消息，默认标为已读。
- 默认只接受**同一 DeepSeek 账号**的实例；未登录时退化为同一操作系统用户 + 主机名的本机范围。
- **AI 接管**：面板顶部可一键开启，收到的 peer 消息由本机智能体自动处理并回复。
- 消息在传输中加密并签名；中继只转发密文信封。

## 账号要求

默认 `requireSameAccount: true`，只与同一 DeepSeek 账号的实例握手。这个账号 scope 只是**防误连的过滤条件**，真正认证消息的是双方共享的 `sharedSecret`，不是账号本身。

确实需要跨账号通信时：

1. 双方在设置里关闭「要求同账号」（`requireSameAccount: false`）；
2. 双方配置相同的 `sharedSecret`；
3. 使用 `local` / `lan` / `manual` 传输。

当前 Cloudflare relay 按账号 scope 分 Durable Object 房间，所以不同账号即使关闭同账号要求，也不会进同一个 relay 房间；跨账号中继需要另行改 relay 的房间键。

## AI 接管

面板顶部「AI 接管」按钮或设置里的 `autoReply` 打开后：

- 在设置的「接管会话」里指定一个活跃 Agent 会话（`autoReplySession`）时，消息会优先注入该 Agent，即使本机打开了多个会话。
- 未指定时，如果本机**恰好只有一个**活跃 Agent 会话，消息会以带 peer id 的提示注入该 Agent；Agent 用 `peer_link_send` 回复。
- 没有可选会话，或指定会话已关闭时，用当前默认模型直接生成一条回复（仍不需要人工）。
- 自动回复会带 `auto: true` 标记（消息旁显示 `AI`）；收到 auto 消息不会再次触发接管，避免两个实例无限互回。
- 每个 peer 10 分钟内最多 6 次自动回复；超出后只入 inbox，不自动回。
- 自动回复失败会在面板显示原因（模型未配置、无可用 provider 等）。

注意：AI 接管会产生模型调用费用；它不会执行对端的指令，只是聊天回复。要让它调用工具或拥有某个会话的完整上下文，请让该实例保持一个打开的 Agent 会话。

## 设置

在**左下角头像 → 设置 → 实例互传**里修改。所有字段都有默认值。

设置页保存的值写入 `%DSH_HOME%\peer-link\state\<profile>\settings.json`（0600），优先于 profile 里的 Config；profile Config 作为基础默认值。页面始终使用插件自己的设置 API，不依赖 Host `settings` 服务。

```yaml
- id: peer-link
  name: '@local/dsh-peer-link'
  config:
    name: "书房电脑"
    transports: [local, lan, relay]
    listenPort: 45873
    sharedSecret: "两端相同的随机短语"
    relayUrl: "wss://dsh-peer-relay.<subdomain>.workers.dev/peer"
    relayToken: "与 Worker 的 RELAY_TOKEN 相同"
    requireSameAccount: true
    maxMessages: 300
```

字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `name` | 主机名 | 实例显示名 |
| `transports` | `[local]` | 可多选：`local` / `lan` / `manual` / `relay` |
| `listenHost` | 空 | 空 = `127.0.0.1`，启用 LAN 时 = `0.0.0.0` |
| `listenPort` | `0` | 对端端口，0 = 随机；端口映射/防火墙建议固定 |
| `udpPort` | `45872` | LAN 组播端口 |
| `manualPeers` | `[]` | 例如 `http://192.168.1.20:45873` |
| `sharedSecret` | 空 | E2EE 配对密钥；跨机器必须相同 |
| `relayUrl` | 空 | 例如 `wss://.../peer` |
| `relayToken` | 空 | 中继访问令牌 |
| `requireSameAccount` | `true` | 拒绝其它账号 |
| `autoReply` | `false` | 让本机 AI 自动接管收到的 peer 消息 |
| `autoReplySession` | 空 | 指定接管的 Agent 会话 id；空 = 自动选择唯一会话 |
| `maxMessages` | `300` | 每个会话保留条数 |

`transports` 可以同时包含多个。同一实例有多条路径时优先用直连地址；中继只作为 NAT 后的可达路径。

## 同机 / 局域网 / 手动

### 同机

两个实例共享同一个 `$DSH_HOME`（Windows 默认 `C:\Users\<你>\.dsh`）时，通过下面的目录交换实例描述并自动握手：

```
%DSH_HOME%\peer-link\instances\<instanceId>.json
```

心跳每 5 秒一次，30 秒未更新的条目会被忽略。端口默认随机。

### 本机双实例测试

Desktop 的 `desktop` profile 由 Electron 独占，不能再启动第二个 Desktop。用一个独立的 Web profile 作为第二实例即可：

```powershell
$dsh = "C:\Users\<你>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"

# 只需第一次：把插件装进测试 profile
& $dsh plugin --profile peer-test add "D:\Deepseek Harness Workspace\peer-link"

# 启动第二个 Web 实例；终端会打印带 token 的 URL
$env:DSH_PROFILE = 'peer-test'
& $dsh --profile peer-test --patch "D:\Deepseek Harness Workspace\peer-test-peer-link.patch.yml" --port 13359 --no-open
```

打开终端打印的 `http://127.0.0.1:13359/?token=...`，在**第二个页面登录同一个 DeepSeek 账号**。Desktop 那个实例已经登录；两边都打开「实例互传」面板，几秒内应互相出现。

- 第二个实例现在可能显示「本地账号」，说明还没登录；登录后账号 watch 会自动更新，无需重启（旧版本最多等 5 分钟，或重启该进程）。
- CLI Web 实例重启后可能需要在这个页面重新登录账号；Desktop 的登录状态不会自动带过去。
- 停止第二个实例：在启动它的终端 Ctrl+C，或结束对应进程；不会影响 Desktop。
- 要让第二实例以后不带 `--patch` 也能启动，在它的 Plugins 页启用 Peer Link，把 bundle 写进 `peer-test` profile 即可。

### 局域网

```yaml
transports: [local, lan]
```

- 默认监听 `0.0.0.0`，UDP 端口 `45872`。
- Windows 防火墙需要允许 DSH 入站 TCP（`listenPort`）和 UDP（`udpPort`）。
- 如果 UDP 发现被拦，可改用 `manual` 直接填对端地址。

### 手动节点

```yaml
transports: [local, manual]
manualPeers:
  - "http://192.168.1.20:45873"
```

适合 VPN、端口映射、固定 IP 或跨网段。仍要求相同的 `sharedSecret` 和同一个账号。

如果对端也要主动连你，`listenHost` 需设为对端可达的地址（通常是 `0.0.0.0`，或 VPN 网卡地址），并放行 `listenPort`；只填写 `manualPeers` 只能保证你主动连出去。

## Cloudflare Worker 中继（可选）

中继不是必需组件。需要公网互传、且两端都在 NAT 后面时，它是比端口映射更稳的方案。

详细部署见 [relay/README.md](relay/README.md)。最短流程：

```powershell
cd relay
npx wrangler login
npx wrangler secret put RELAY_TOKEN
npx wrangler deploy
```

然后设置：

```yaml
transports: [local, relay]
relayUrl: "wss://dsh-peer-relay.<subdomain>.workers.dev/peer"
relayToken: "与 RELAY_TOKEN 相同"
sharedSecret: "两端的 E2EE 配对密钥"
```

免费额度（Cloudflare 当前 Free 计划）：

- Worker：100,000 请求/天，10 ms CPU/请求。
- Durable Object：100,000 请求/天，13,000 GB-s/天，5 GB SQLite。
- WebSocket 使用 Hibernation API；空闲不计 duration。
- 入站 WebSocket 消息按 20:1 折算请求；出站不单独计费。

个人两三个实例通常每天只有几百次请求。超额会失败，需要 Workers Paid（最低约 `$5/月`）。

## 安全模型

- 账号范围：只共享 `sha256("dsh-peer-link:account:" + userId)` 的哈希；不发送原始 userId 或 token。
- 传输：AES-256-GCM 加密消息体，HMAC-SHA256 签名请求；时间戳 + nonce 防重放。
- 中继：只看到实例 ID、账号 scope、消息大小和时间；看不到明文，也不能伪造签名。
- 配对密钥：
  - 未配置 `sharedSecret`：使用 `%DSH_HOME%\peer-link\secret.key`（首次创建，0600），同一操作系统用户下的本机实例共享。
  - 配置 `sharedSecret`：两端用 scrypt 派生同一把密钥，适合跨机器。
- `RELAY_TOKEN` 只控制中继使用权；泄露它不会泄露消息，泄露 `sharedSecret` 才会。
- 默认只绑定 `127.0.0.1`；LAN 和 relay 都需要显式开启。
- 消息存储在本机 `%DSH_HOME%\peer-link\state\<profile>\messages.json`，不会上传云端。每个 profile 有自己的消息、设置和 Web token；`secret.key` 和 `instances/` 注册表由同机实例共享。

## 工具输出与 Agent 行为

- `peer_link_send` 只负责发消息，不会在对端执行命令；对端人类会在面板里看到内容。
- 对端离线时消息进入队列，恢复在线后自动重试（最多 20 次）；relay 模式由中继暂存离线密文（最多 100 条/实例，7 天）。
- `peer_link_inbox` 读取消息并默认标为已读；传 `markRead: false` 可以只读不标记。

## 故障排查

**列表里没有对端**

- 两端都安装并启用了插件，且都刷新了页面。
- 两端登录同一个 DeepSeek 账号；未登录时只匹配同机同用户。
- 检查 `transports` 是否包含对端使用的路径。
- 跨机器确认 `sharedSecret` 相同、防火墙放行；relay 模式确认 `relayUrl` 和 `relayToken`。

**显示「密钥不一致」**

两端 `sharedSecret` 必须完全一致。修改后重启 DSH；如果仍不一致，检查是否一端设置了 `sharedSecret`、另一端没有。

**消息一直排队**

对端离线，或路径不可达。先确认对端面板显示在线；跨机器用 `Test-NetConnection <host> -Port <listenPort>` 检查端口。relay 模式检查顶部「中继已连接」状态和 Worker 日志。

**中继未连接**

- `relayUrl` 必须是 `wss://`（本地开发可用 `ws://127.0.0.1:8787/peer`）。
- Worker 的 `RELAY_TOKEN` 与插件 `relayToken` 一致。
- 免费额度是否用尽；Worker 是否部署成功（`/health` 返回 `{"ok":true}`）。
- 当前运行时是否提供 WebSocket；Host 日志会显示 `relay connection failed` 等原因。

**端口/发现状态**

面板底部显示本机 endpoint 和 key 指纹；点「复制本机连接信息」可把这几项发给对端排查。局域网/中继错误会显示在面板顶部。

## 开发与测试

需要 Node 24：

```powershell
node --test --test-force-exit test/*.test.mjs
```

覆盖：

- 协议签名、AES-GCM、hello 证明、relay 签名。
- 两个真实 `PeerLinkNode` 的握手、双向消息、错误密钥检测。
- relay client：握手、加密消息、离线排队、错误密钥。
- relay node：两个 `PeerLinkNode` 通过 WebSocket 中继握手和收发。
- AI 接管：唯一 Agent 注入路径、默认模型直答路径、`auto` 标记与防回环。
- 实例身份：profile 稳定 id、重启复用、离线无历史 peer 自动清理、手动 forget。
- Host 胶水：注册表、鉴权 Web API、三个工具的参数 Schema 子集检查。
- Config 默认值与多传输选择。
- Client：Slot 注册、面板/侧栏/会话渲染的 mock 冒烟测试。
- 11 个测试用例全部通过。
- Cloudflare Worker：已用 `wrangler dev` 在本地验证握手、在线消息和离线队列；尚未部署到真实 Cloudflare 账号。

## 文件

```
peer-link/
  index.js              Host 插件：账号、密钥、Web API、工具、Config
  client.js             Web 面板、侧栏图标、Locale、状态同步
  lib/protocol.js       签名、加密、hello/relay 证明
  lib/store.js          消息持久化
  lib/node.js           HTTP/UDP/注册表/手动/relay 传输与重试
  lib/relay-client.js   可选 WebSocket 中继客户端
  lib/tools.js          三个模型工具与 Schema 防护
  relay/worker.js       可选 Cloudflare Worker + Durable Object
  relay/wrangler.toml   免费计划可用配置（SQLite DO + Hibernation）
  relay/README.md       中继部署说明
  cordis.patch.yml      bundle 行
  locale/{en,zh}.json   插件管理页显示文案
  icon.svg              插件图标
  test/                 协议、Host、Client、relay、实例身份测试
```

## 离线 peer 清理

- 每个 profile 首次启动会把 instance id 写入 `%DSH_HOME%\peer-link\state\<profile>\instance-id`；以后重启复用。把同一个 profile 同时跑两个进程会共享这个 id，所以双实例测试请用不同 profile。
- 维护循环会删除离线超过 10 分钟、且没有任何消息记录的 peer。
- 有历史记录的旧 peer 不会自动删除；面板左下角「清理离线 (n)」会在确认后删除所有离线 peer 及其本地聊天记录。
- 旧版本升级后可能会留下一个带历史的离线 peer，手动清理一次即可；此后不再堆积。

## 已知限制

- 没有 DeepSeek 官方消息中继；公网互传依赖你自己的 Worker / VPN / 端口映射。
- 没有端到端前向保密；密钥轮换需要同时重启两端。
- 群聊、文件传输、输入状态提示尚未实现；当前是一对一文本消息。
- 面板 UI 已通过 mock 渲染测试，但当前插件处于关闭状态，尚未在真实页面中做最终视觉验收。
