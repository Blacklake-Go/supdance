# 部署与 OAuth

## 容器和网络

复制 `.env.example` 到 `.env.production`，删除开发标记，配置 HTTPS origin、独立 issuer、合作方接口和服务秘密。会话加密密钥可用 `openssl rand -hex 32` 生成。秘密通过部署环境保管。使用 `docker compose up -d --build`。反向代理到同机的 8787，使用 TLS 并允许 `POST /mcp`、浏览器回调及 OAuth discovery 访问。浏览器流式响应应禁用代理缓冲，超时覆盖 90 秒的文本生成上限。

单实例 SQLite 使用 WAL。每个部署使用独立卷与权限。应用停止后复制数据库和 WAL 相关文件，或使用 SQLite 在线备份 API。回滚时使用相容的数据库备份和镜像。当前 schema 为 1。扩展成多副本前，先把会话、审批和并发锁迁到共享数据库。

`/healthz` 检查进程和版本，`/readyz` 检查 SQLite 和必要配置。生产就绪仍需用测试账户验证合作方 ACL、额度和任务链路。CI 在主分支和 PR 验证。推送版本 tag 后构建并发布独立 GHCR 镜像，生产环境由部署方选用已验证的 tag。

## OAuth

- 由独立授权服务器提供身份和同意页面。授权服务器可联邦使用 Supdance 登录。ChatGPT 与 Codex 需要 DCR 和标准 OAuth discovery。生产 MCP 资源是 `SUPDANCE_PLUGIN_ORIGIN/mcp`，授权和 token 兑换都需支持该 RFC 8707 resource。
- 浏览器使用单独的机密 OAuth client，精确注册 `SUPDANCE_PLUGIN_ORIGIN/oauth/callback`，支持 PKCE S256、RFC 9207 的回调 `iss` 和 HTTP Basic client 认证。MCP 客户端不得使用浏览器 client ID。用户标识 `sub` 必须在这些客户端间可映射为同一稳定主体。
- 资源服务器使用 RFC 7662 introspection。issuer 必须提供 `active`、`iss`、`sub`、`aud`、`exp`、`scope` 、`client_id` 和 `token_type: Bearer`。配置专门的 introspection 凭据。撤销令牌后 introspection 应立即返回 inactive。每个受保护请求重新检查，不缓存 active 响应。
- 浏览器令牌采用 AES-GCM 存在服务端，客户端收到短期 HttpOnly SameSite 会话 Cookie。OAuth 回调有一次性 state 和 PKCE。浏览器写路径需要精确匹配 Origin。MCP 无法签发浏览器会话或调用用户确认路由。审批事件与工具调用分别记账。
- 公共 MCP 工具目录与 widget 模板支持匿名发现。用户数据和工具执行需要带作用域的 OAuth token。未经认证的调用会带 OAuth challenge。限制 MCP 请求 Origin、体积、每分钟总量和单用户次数；上线在网关配更严格的按 IP/用户配额和拥塞监控。
- Codex 接入示例使用 `codex mcp add supdance --url "$SUPDANCE_PLUGIN_ORIGIN/mcp" --oauth-client-registration dcr`，随后执行 `codex mcp login supdance`。用项目级配置或受控的用户配置保留隔离。ChatGPT 使用发布包声明的 HTTPS MCP，实测前在 OpenAI 开发模式接入新连接。

参考 [OpenAI OAuth](https://developers.openai.com/plugins/build/auth) 和 [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。
