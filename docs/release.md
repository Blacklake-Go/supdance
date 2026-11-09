# OpenAI 发布资料

本仓库维护一个全新的 Supdance 条目。公开清单使用统一的 Agent Plugins 结构，身份 `supdance`，显示名 `Supdance`，分类 `Creativity`。

- [清单](../plugin/plugin.json) 含中英文介绍、示例、版本说明、五条正向及三条负向审核用例。用例描述期望行为，实际 OpenAI 平台测试需在远程连接就绪后执行。
- [图标](../plugin/assets/icon.png) 是独立的 512 × 512 PNG。 [短剧技能](../plugin/skills/short-drama/SKILL.md) 随包分发。
- [隐私、条款与支持草案](policy-draft.md) 按已实现的数据路径起草。发布者确认实际运营、留存和删除流程后再发布政策页面。
- [包脚本](../scripts/package.ts) 在提供实际 MCP 地址时写入 `mcp.json`，声明 HTTPS Streamable HTTP、OAuth 客户端注册方式和基础作用域。候选 ZIP 缺少远端地址时仅包含清单、技能与图标。为公开提交运行严格模式，设置以下值。

| 配置 | 含义 |
| --- | --- |
| `SUPDANCE_PLUGIN_PACKAGE_MCP_URL` | 经部署并验证的公开 HTTPS MCP URL |
| `SUPDANCE_PLUGIN_PACKAGE_OAUTH_CLIENT_ID` | 可选。指定专用预注册客户端，省略时声明 DCR |
| `SUPDANCE_PLUGIN_PACKAGE_OAUTH_CLIENT_AUTH` | 可选。预注册客户端认证方法，默认 `client_secret_basic` |
| `SUPDANCE_PLUGIN_PUBLISHER` | 已验证的 OpenAI 开发者名称 |
| `SUPDANCE_PLUGIN_PRIVACY_URL` / `SUPDANCE_PLUGIN_TERMS_URL` / `SUPDANCE_PLUGIN_SUPPORT_URL` | 实际适用于插件且公开可访问的页面 |
| `SUPDANCE_PLUGIN_DEMO_URL` | 审核者可访问的真实演示 |
| `SUPDANCE_PLUGIN_COUNTRIES` | 发布者确认的 JSON 数组，使用两位国家代码。明确选择全量时使用空数组 |

## 演示和审核账户

在已部署的开发连接里，录制登录到获得画布回执的完整路径。用新测试账号连接 Supdance，读取授权测试项目，输入短剧构想，生成结构化镜头，打开确认页检查内容，确认并执行，再回读节点。演示一次跳过确认被拒的结果。测试账号要能访问预先准备好的画布，另备一个隔离账号验证拒绝。以审核后台的安全凭据字段提交登录信息。录制脚本不等同于录屏。不要用自动化测试夹具填充审核页面或演示。

## 提交

1. 在用户指定的 OpenAI 组织下选择项目，确认验证身份、国家范围和开发者权限。
2. 运行 `bun run package:plugin --submission`，检查 ZIP 内容后在 Plugins 入口创建新草稿。
3. 完成域名挑战、OAuth 连接、工具扫描和平台复测，填入真实演示及审核账号。
4. 由获授权的发布者确认平台申报项后提交审核。审核通过后按该条目状态发布。

公开版本默认关闭媒体扣分工具。已配置的媒体流程只支持已有权益内的使用，当前实现不提供购买或充值。媒体权益的目录资格需在开放媒体工具前单独核对。

参考 [包格式](https://developers.openai.com/plugins/build/plugins)、[发布流程](https://developers.openai.com/plugins/deploy/submission) 和 [目录规则](https://developers.openai.com/plugins/plugin-guidelines)。
