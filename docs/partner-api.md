# Supdance 合作方接口 v1

新服务独立保存会话、草稿、OAuth 浏览器会话、审批和审计。主站拥有项目、画布、模型、计费、媒体任务和资产。以下是需要 Supdance 主站或其网关提供的版本化合同。现有依赖站点 Cookie 的网页 API 与此合同的身份语义不同。

## 安全与数据边界

- 基础地址由 `SUPDANCE_PLUGIN_BRIDGE_URL` 固定配置，生产必须走 HTTPS。服务端调用 `/v1` 下的固定路由，拒绝重定向。出站认证使用独立可轮换的服务凭证；合作方应限制服务身份可访问的路由和资源。生产建议再配网络入口白名单。
- `X-Supdance-Subject` 是固定 OAuth issuer 下已 introspect 的用户 `sub` 的 UTF-8 base64url 表示。合作方收到并验证服务凭证后，才可解码并以持久身份映射查询现有 Supdance 用户。映射必须由可信身份流程建立。禁止用 email、展示名称或请求正文中的用户 ID 代替映射。
- 合作方每次检查账号状态、对象所有权、项目授权、组织策略和额度。对画布、任务和资产按项目和用户组合查询。拒绝时返回标准 HTTP 状态。禁止向插件返回上游密钥、浏览器 Cookie、内部错误详情或未授权字段。
- 服务端 token 通过独立密钥存放，主站数据库始终由主站持有。日志只保留本地散列身份、事件、目标 ID 和结果码。使用带权限和备份的独立持久卷。

## 路由

成功的 JSON 响应为下表所列对象。日期使用 Unix 毫秒。ID 匹配 `^[\w-]{1,128}$`。完整字段和大小限制见 [共享校验合同](../shared/contracts.ts)。

| 请求 | 请求体和业务约束 | 成功响应 |
| --- | --- | --- |
| GET /v1/projects | 仅当前授权的项目，最多 100 个 | `[{id,title,summary}]` |
| GET /v1/projects/:id | 项目 ACL | `{id,title,summary}` |
| GET /v1/projects/:projectId/canvases | 当前用户有权访问的画布，最多 100 个 | `[{id,projectId,title}]` |
| GET /v1/projects/:projectId/canvases/:canvasId | 读取 ACL 和实际版本，最多 100 个最小节点摘要 | `{id,projectId,revision,nodes:[{id,type,label}]}` |
| GET /v1/projects/:projectId/tasks/:taskId | 按项目和所有权查媒体任务 | `{id,projectId,kind,status,progress?,assetIds,errorCode?}` |
| GET /v1/media/models/:kind | 当前用户可选的 image、video 或 music 型号 | `[{id,name}]` |
| GET /v1/text/models | 当前用户可用且已包含在权益内的文本型号 | `[{id,name}]` |
| POST /v1/text/stream | `{skill,language,model?,brief,context?,projectId?,instructions,schema?,maxCredits:0}` | UTF-8 `text/plain` 流。自由对话是文本，技能结果为单一 JSON 对象 |
| POST /v1/actions/preview | `{action}`，校验项目权限、画布版本和媒体价格，生成绑定的限时报价 | `{id,credits,expiresAt}` |
| POST /v1/actions/commit | `{action,quoteId,maxCredits}` 与 `Idempotency-Key`，原子提交 | 项目记录、画布版本及节点 ID，或媒体任务回执 |

文本流只允许使用已有权益且请求不会额外扣除积分的模型。合作方将 `instructions` 放在系统指令层，把用户创作内容、附件、历史和授权项目数据放在输入层。项目上下文不得扩大用户权限。建议限制上游并发和生成体积，客户端断开时终止推理。接口返回 402 表示权益不满足。若文本也按次扣分，需要先新增单独的报价及确认流程。

## 预览和执行

- 项目创建操作接受标题和摘要。画布操作仅追加校验通过的镜头，不提供覆盖、删除、跨项目移动。媒体操作记录类别、项目、模型、提示词和可选镜头编号。
- 报价绑定用户、规范化 payload、目标项目、版本、模型、报价和到期时间。画布和项目的报价应为零。提交时重新检查所有权限和实际成本，要求实际消耗小于等于用户确认的上限，并拒绝已过期或发生变化的报价。
- 提交服务以调用方、用户和幂等键唯一索引，提交状态与回执持久化。同一幂等键同一请求返回原回执。不同请求复用同一键返回冲突。若已经执行，须先返回持久回执，再判断当前报价有效期。媒体任务创建和积分预扣必须共用事务或可恢复的事务性 outbox。
- 只有确认未产生外部副作用的业务拒绝可用 400、403、404、409、422。超时、响应损坏、结果不确定用 5xx，使客户端能用原幂等键查回。合作方应对暂时失联、重试、版本冲突和配额做并发演练。
- 画布节点及媒体资产继续由主站管控。任务查询可返回已生成资产 ID。将媒体资产自动挂到画布节点仍需独立授权和接口。
