export interface ScopeDetail {
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  iconSvg: string;
}

export const SCOPE_REGISTRY: Record<string, ScopeDetail> = {
  "story:generate": {
    titleZh: "AI 剧本与分镜创作",
    titleEn: "Story & Storyboard Generation",
    descZh: "使用自然语言生成短剧大纲、角色设定、剧本对白与结构化分镜镜头",
    descEn: "Generate outlines, characters, scripts, and storyboard shots via AI Agent",
    iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/><path d="M6 14h6"/></svg>`,
  },
  "projects:read": {
    titleZh: "读取创作项目",
    titleEn: "Read Projects",
    descZh: "获取已授权短剧项目的列表、剧情大纲与元数据信息",
    descEn: "View authorized short drama projects and metadata",
    iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  },
  "projects:write": {
    titleZh: "管理创作项目",
    titleEn: "Manage Projects",
    descZh: "在已授权项目内创建新剧本、更新大纲与剧情草稿",
    descEn: "Create and update project scripts and draft outlines",
    iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  },
  "canvas:read": {
    titleZh: "读取智能画布",
    titleEn: "Read Canvas Context",
    descZh: "读取画布节点、分镜编排、素材关联与视口状态",
    descEn: "Access storyboard nodes, asset links, and canvas context",
    iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>`,
  },
  "canvas:write": {
    titleZh: "写入画布分镜",
    titleEn: "Write Canvas Storyboard",
    descZh: "将生成的分镜镜头写入授权画布（修改前必须在 Supdance 独立审批）",
    descEn: "Append storyboard shots to canvas (requires separate human preview & approval)",
    iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/><path d="M12 9v12"/></svg>`,
  },
};

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return m;
    }
  });
}

const BASE_STYLES = `
:root {
  --bg: #09090b;
  --surface: #121216;
  --surface-raised: #18181f;
  --border: rgba(255, 255, 255, 0.08);
  --text: #f4f4f5;
  --text-muted: #a1a1aa;
  --text-dim: #71717a;
  --primary-gradient: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  --accent-purple: #8b5cf6;
  --radius-lg: 20px;
  --radius-md: 12px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse 65% 45% at 50% -10%, rgba(99, 102, 241, 0.18), transparent 75%),
    radial-gradient(ellipse 40% 30% at 85% 100%, rgba(139, 92, 246, 0.08), transparent);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  line-height: 1.5;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 32px 16px;
  -webkit-font-smoothing: antialiased;
}
.card {
  width: 100%;
  max-width: 520px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.04);
  padding: 32px 28px;
}
.connector-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 22px;
}
.app-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.app-icon {
  width: 50px;
  height: 50px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.app-icon.supdance {
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.app-icon.client {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: #f4f4f5;
}
.app-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.connector-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  color: #818cf8;
  margin-top: -18px;
}
.heading-area {
  text-align: center;
  margin-bottom: 20px;
}
.title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
  margin-bottom: 6px;
}
.subtitle {
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.45;
}
.account-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 20px;
}
.account-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.account-name-label {
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.account-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #34d399;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.2);
  padding: 3px 9px;
  border-radius: 999px;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}
.permissions-container {
  margin-bottom: 20px;
}
.section-title {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  margin-bottom: 10px;
}
.scope-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 11px 13px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}
.scope-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.12);
  color: #818cf8;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}
.scope-content {
  flex: 1;
}
.scope-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.scope-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.scope-tag {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
}
.scope-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}
.security-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(99, 102, 241, 0.06);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: var(--radius-md);
  margin-bottom: 24px;
}
.security-icon {
  color: #818cf8;
  flex-shrink: 0;
  margin-top: 2px;
}
.security-content {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}
.security-title {
  font-weight: 600;
  color: #c7d2fe;
  margin-bottom: 3px;
}
.actions-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  padding: 11px 18px;
  border-radius: var(--radius-md);
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s ease;
  min-height: 44px;
  border: none;
}
.btn-primary {
  background: var(--primary-gradient);
  color: #ffffff;
  box-shadow: 0 4px 14px -2px rgba(79, 70, 229, 0.45);
}
.btn-primary:hover {
  background: linear-gradient(135deg, #4338ca 0%, #4f46e5 100%);
  box-shadow: 0 6px 18px -2px rgba(79, 70, 229, 0.6);
  transform: translateY(-1px);
}
.btn-primary:active {
  transform: translateY(0);
}
.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  color: var(--text);
}
.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.16);
  color: #fff;
}
.btn-block {
  width: 100%;
}
.auth-notice-card {
  text-align: center;
  padding: 16px 8px;
}
.lock-icon-wrap {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.25);
  color: #818cf8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}
.auth-notice-card p {
  color: var(--text-muted);
  font-size: 13.5px;
  margin-bottom: 20px;
  line-height: 1.5;
}
.auth-btn-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.footer-area {
  margin-top: 24px;
  text-align: center;
}
.footer-links {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.footer-links a {
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.15s;
}
.footer-links a:hover {
  color: #fff;
  text-decoration: underline;
}
.footer-note {
  font-size: 11px;
  color: var(--text-dim);
}
@media (max-width: 480px) {
  .card { padding: 24px 18px; }
  .actions-row { grid-template-columns: 1fr; }
}
`;

function getClientIconSvg(clientName: string): string {
  if (clientName === "ChatGPT") {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12A10 10 0 0 1 12 2Z"/><path d="m9 12 2 2 4-4"/></svg>`;
  }
  if (clientName === "Codex") {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`;
  }
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
}

export function renderConsentHtml(params: {
  heading: string;
  clientName: string;
  subject: string;
  permissions: string[];
  prompt: string;
  actionUrl: string;
  proof: string;
}): string {
  const { heading, clientName, subject, permissions, prompt, actionUrl, proof } = params;
  const isLogin = prompt === "login";

  const clientIcon = getClientIconSvg(clientName);
  const userInitial = (subject || "U").charAt(0).toUpperCase();

  const permissionsHtml = permissions.map((scope) => {
    const detail = SCOPE_REGISTRY[scope] || {
      titleZh: scope,
      titleEn: scope,
      descZh: "允许访问指定的 API 能力与数据",
      descEn: "Allow access to the specified capability",
      iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`,
    };
    return `
      <div class="scope-item">
        <div class="scope-icon-wrap">${detail.iconSvg}</div>
        <div class="scope-content">
          <div class="scope-header">
            <span class="scope-name">${escapeHtml(detail.titleZh)}</span>
            <span class="scope-tag">${escapeHtml(scope)}</span>
          </div>
          <div class="scope-desc">${escapeHtml(detail.descZh)}</div>
        </div>
      </div>
    `;
  }).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(heading)} - Supdance</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <main class="card">
    <div class="connector-header">
      <div class="app-badge">
        <div class="app-icon supdance">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect width="15" height="14" x="1" y="5" rx="2" ry="2"/>
          </svg>
        </div>
        <span class="app-name">Supdance</span>
      </div>
      <div class="connector-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
        </svg>
      </div>
      <div class="app-badge">
        <div class="app-icon client">${clientIcon}</div>
        <span class="app-name">${escapeHtml(clientName)}</span>
      </div>
    </div>

    <div class="heading-area">
      <h1 class="title">${isLogin ? "连接 Supdance 账户" : "授权 Supdance MCP 连接器"}</h1>
      <p class="subtitle">将当前 Supdance 创作账号连接至 ${escapeHtml(clientName)}，启用 AI 短剧大纲、角色与画布协作能力。</p>
    </div>

    <div class="account-bar">
      <div class="account-info">
        <div class="avatar">${escapeHtml(userInitial)}</div>
        <div>
          <div class="account-name-label">当前登录账号</div>
          <div class="account-name">${escapeHtml(subject)}</div>
        </div>
      </div>
      <div class="status-pill">
        <span class="status-dot"></span>已连接
      </div>
    </div>

    <div class="permissions-container">
      <div class="section-title">申请访问权限 · REQUESTED PERMISSIONS</div>
      ${permissionsHtml}
    </div>

    <div class="security-banner">
      <div class="security-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      </div>
      <div class="security-content">
        <div class="security-title">安全控制保障 · Security Assurance</div>
        <div>画布改动仍需逐次确认。物理写入前必须在 Supdance 独立审批页面二次确认。不向 AI 模型暴露密码或 API 密钥，可随时撤销连接。</div>
      </div>
    </div>

    <form method="post" action="${escapeHtml(actionUrl)}">
      <input type="hidden" name="proof" value="${escapeHtml(proof)}">
      <div class="actions-row">
        <button type="submit" name="decision" value="deny" class="btn btn-secondary">取消 / Cancel</button>
        <button type="submit" name="decision" value="allow" class="btn btn-primary">${isLogin ? "确认并继续 / Continue" : "确认授权 / Authorize"}</button>
      </div>
    </form>

    <div class="footer-area">
      <div class="footer-links">
        <a href="https://www.supdance.com/openai-plugin/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a> ·
        <a href="https://www.supdance.com/openai-plugin/terms" target="_blank" rel="noopener noreferrer">服务条款</a> ·
        <a href="https://www.supdance.com/openai-plugin/support" target="_blank" rel="noopener noreferrer">获取支持</a>
      </div>
      <div class="footer-note">由 Supdance OAuth 2.0 &amp; PKCE 安全协议保护</div>
    </div>
  </main>
</body>
</html>`;
}

export function renderSignInHtml(params: {
  loginPage: string;
  continueUrl: string;
}): string {
  const { loginPage, continueUrl } = params;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录 Supdance 创作账户 - Supdance</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <main class="card auth-notice-card">
    <div class="lock-icon-wrap">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </div>

    <h1 class="title">登录 Supdance 创作账户</h1>
    <p>连接 MCP 短剧创作与智能画布能力前，请先登录你的 Supdance 账户。登录成功后返回此窗口即可继续完成连接授权。</p>

    <div class="auth-btn-stack">
      <a target="_blank" rel="noopener noreferrer" href="${escapeHtml(loginPage)}" class="btn btn-primary btn-block">Open Supdance login / 打开登录页</a>
      <a href="${escapeHtml(continueUrl)}" class="btn btn-secondary btn-block">已完成登录，点击继续 / Continue</a>
    </div>

    <div class="footer-area">
      <div class="footer-links">
        <a href="https://www.supdance.com/openai-plugin/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a> ·
        <a href="https://www.supdance.com/openai-plugin/terms" target="_blank" rel="noopener noreferrer">服务条款</a> ·
        <a href="https://www.supdance.com/openai-plugin/support" target="_blank" rel="noopener noreferrer">获取支持</a>
      </div>
      <div class="footer-note">由 Supdance OAuth 2.0 &amp; PKCE 安全协议保护</div>
    </div>
  </main>
</body>
</html>`;
}
