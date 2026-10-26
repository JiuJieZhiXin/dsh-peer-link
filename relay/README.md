# Peer Link relay (Cloudflare Worker)

这是 Peer Link 的可选中继，不是必需组件。只有 `transports` 里包含 `relay` 并配置了 `relayUrl` 时，DSH 才会连接它。

## 部署

需要 Node.js、Cloudflare 账号和一个 Cloudflare API token（`wrangler login` 或 `CLOUDFLARE_API_TOKEN`）。

```powershell
cd relay
npx wrangler login
npx wrangler secret put RELAY_TOKEN
npx wrangler deploy
```

记下部署输出的 `https://dsh-peer-relay.<你的子域>.workers.dev`，WebSocket 地址是：

```
wss://dsh-peer-relay.<你的子域>.workers.dev/peer
```

`RELAY_TOKEN` 是访问中继的令牌，和端到端加密的 `sharedSecret` 是两件事：

- `RELAY_TOKEN`：证明“允许使用这个中继”。
- `sharedSecret`：两端派生消息加密密钥；中继永远看不到它。

## DSH 配置

在插件设置页启用 `relay`，或写进 profile 补丁：

```yaml
- id: peer-link
  name: '@local/dsh-peer-link'
  config:
    transports: [local, relay]
    relayUrl: "wss://dsh-peer-relay.<你的子域>.workers.dev/peer"
    relayToken: "与 RELAY_TOKEN 相同"
    sharedSecret: "两端的 E2EE 配对密钥"
```

`transports` 可以同时包含多个：`local`、`lan`、`manual`、`relay`。同一对端同时有多种路径时，优先使用直连地址；中继只作为可达路径。

## 免费额度

按 Cloudflare 当前 Free 计划：

- Worker：100,000 请求/天，10 ms CPU/请求。
- Durable Object：100,000 请求/天，13,000 GB-s/天，5 GB SQLite。
- WebSocket 使用 Hibernation API；空闲不计 duration。
- 出站 WebSocket 消息不单独计费；入站消息按 20:1 折算。

个人两三个实例使用通常每天只有几百次请求。超过免费额度会失败，需要升级 Workers Paid（最低约 $5/月）。

参考：

- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/durable-objects/platform/pricing/>

## 数据与安全

- Worker/DO 只转发加密信封，看不到消息明文。
- 离线消息按账号 scope 存在 DO SQLite，最多 100 条/实例，7 天过期。
- 中继按账号 scope 分房间；同账号过滤还在客户端 hello 里二次校验。
- `RELAY_TOKEN` 泄露只影响中继使用权，不会泄露消息内容；`sharedSecret` 泄露才会。
- 中继没有读取消息的密钥，不能伪造签名；客户端会验证 HMAC 和 AES-GCM tag。

## 本地开发

```powershell
cd relay
npx wrangler dev
```

`wrangler dev` 默认在 `http://127.0.0.1:8787`；把 `relayUrl` 设为 `ws://127.0.0.1:8787/peer` 即可。开发时同样需要设置 `RELAY_TOKEN`（`.dev.vars` 或环境变量）。
