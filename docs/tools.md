# MCP 工具和授权

所有工具的输入、输出和 OAuth 声明可从远程 MCP 的 `tools/list` 读取。使用协议自身的参数验证、JSON Schema 和 `structuredContent`。业务错误使用 `isError`、机器可读错误码和可重试标记。

| 工具 | Scope | 行为 |
| --- | --- | --- |
| `supdance_plan_story` | `story:generate` | 返回创作目标、假设和可解释的阶段 |
| `supdance_generate_outline` | `story:generate` | 返回梗概、世界、分集冲突、悬念和连续性 |
| `supdance_create_character` | `story:generate` | 返回角色草案、关系、动机和风格锚点 |
| `supdance_generate_script` | `story:generate` | 返回单集场景、动作、对白和钩子 |
| `supdance_rewrite_dialogue` | `story:generate` | 根据源文本与用户约束重写对白 |
| `supdance_generate_storyboard` | `story:generate` | 返回唯一镜头编号和完整制作字段 |
| `supdance_list_projects` / `supdance_get_project` | `projects:read` | 读取当前用户授权的项目列表或单个摘要 |
| `supdance_create_project` / `supdance_commit_project` | `projects:write` | 新项目预览与已确认后的提交；仅在宿主完成项目创建合同后启用 |
| `supdance_list_canvases` | `canvas:read` | 列出当前项目内有权访问的画布 |
| `supdance_get_canvas_context` | `canvas:read` | 读取目标画布的版本和最小节点上下文 |
| `supdance_preview_canvas_changes` / `supdance_apply_canvas_changes` | `canvas:write` | 镜头追加预览与已确认后的提交 |
| `supdance_generate_image` / `supdance_generate_video` / `supdance_generate_music` | `media:generate` | 仅在媒体开关启用时生成报价，用户需要在网页确认 |
| `supdance_commit_media_generation` | `media:generate` | 仅在媒体开关启用时提交已确认任务 |
| `supdance_get_task_status` | `media:read` | 查询任务状态、进度及资产 ID |

创作工具使用已有权益中的文本模型，不写项目或画布。预览工具的写入仅在插件审批表。提交工具按用户、操作种类和审批 ID 校验，在远端幂等合同下执行。跨账号读取未知或未授权项目返回拒绝或找不到资源。

常见状态包括 `pending`、`approved`、`running`、`done`、`rejected`、`failed`。未确认时返回 `approval_required`。引用旧版本或报价已变时，重新读取并预览。写入结果不明确时，使用原审批 ID 重试。确认页会显示原始操作内容及实际回执。
