# Supdance

独立的 OpenAI 插件与短剧创作工作台。提供中文和英文的短剧规划、大纲、角色、单集剧本、对白及分镜。ChatGPT 和 Codex 走远程 Streamable HTTP MCP，网站工作台走独立的 OAuth 浏览器会话。

## 本地运行

使用 Bun 1.4.3。插件打包需要系统的 `zip` 和 `unzip`。

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
SUPDANCE_PLUGIN_DEV=1 bun run start
```

访问 `http://127.0.0.1:8787`。未配置 OAuth 和合作方接口时，可打开网站和枚举 MCP 工具，登录与业务请求会明确报告配置缺失。`/healthz` 检查进程，`/readyz` 检查数据库和配置。真实创作依赖 [Supdance 合作方 API](docs/partner-api.md)。测试目录中的 OAuth 与合作方夹具用于自动化测试。

## 创作路径

- 在工作台连接账号、选择项目上下文和可用文本模型。新建对话后可保存输入草稿，并附上最多 32 KB 的 TXT 或 Markdown。切换会话或刷新后从服务器恢复历史。
- 使用规划、大纲、人物、剧本、对白和分镜技能。历史输出支持以指定结果为父节点继续，保留分支。可选中文字进行局部改写。文本流式输出，结构化结果在通过 Schema 校验后显示。
- 预览分镜写入时，工作台读取目标画布当前版本。用户在确认页核对目标和完整镜头，再确认并执行。状态和节点 ID 以主站回执为准。
- 模型只能预览或执行已确认的操作。媒体开关默认关闭。启用后可对图片、视频和音乐创建报价，确认后提交任务，并查询媒体资产 ID。

## 部署与发布

- [部署和 OAuth](docs/deploy.md)
- [主站接口与幂等合同](docs/partner-api.md)
- [工具与授权](docs/tools.md)
- [审核、清单和素材](docs/release.md)
- [隐私、服务条款与支持草案](docs/policy-draft.md)

`bun run package:plugin` 生成开发候选 ZIP。使用 `bun run package:plugin --submission` 为公开发布生成带实际远程连接和发布资料的 ZIP。
