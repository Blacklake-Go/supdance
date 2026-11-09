import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Provider, { errors, interactionPolicy, type Configuration } from "oidc-provider";
import { z } from "zod";
import { scopes } from "../shared/contracts";
import { issuerStore } from "./issuer-store";

const studioScopes = scopes.filter((scope) => !scope.startsWith("media:"));
const mcpCallback = "https://chatgpt.com/connector_platform_oauth_redirect";
const clientPolicyField = "urn:supdance:oauth:client-policy";
const identityResponse = z.object({
  code: z.literal(0),
  data: z.object({ user: z.object({ id: z.string().regex(/^[\w-]{1,128}$/) }).nullable() }),
});

export function issuerConfiguration(env = process.env) {
  const local = env.SUPDANCE_PLUGIN_DEV === "1";
  const origin = z.url().parse(env.SUPDANCE_PLUGIN_ORIGIN);
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (parsed.protocol !== "https:" &&
      !(local && parsed.protocol === "http:" && parsed.hostname === "127.0.0.1"))) {
    throw new Error("Invalid Supdance issuer origin");
  }
  const base = "/supdance-auth";
  const issuer = origin + base;
  if (env.SUPDANCE_PLUGIN_OAUTH_ISSUER !== issuer) throw new Error("Supdance issuer must match the dedicated origin and path");
  const confidentialId = z.string().regex(/^[\w-]{6,128}$/);
  const secret = z.string().regex(/^[a-f0-9]{64}$/i);
  const webId = confidentialId.parse(env.SUPDANCE_PLUGIN_WEB_CLIENT_ID);
  const introspectionId = confidentialId.parse(env.SUPDANCE_PLUGIN_INTROSPECTION_ID);
  if (webId === introspectionId) throw new Error("OAuth web and introspection clients must be separate");
  const webSecret = secret.parse(env.SUPDANCE_PLUGIN_WEB_CLIENT_SECRET);
  const introspectionSecret = secret.parse(env.SUPDANCE_PLUGIN_INTROSPECTION_SECRET);
  const cookieKey = secret.parse(env.SUPDANCE_PLUGIN_ISSUER_COOKIE_KEY);
  if (new Set([webSecret, introspectionSecret, cookieKey]).size !== 3) throw new Error("Issuer credentials must be distinct");
  const webOrigin = env.SUPDANCE_PLUGIN_WEB_ORIGIN || origin;
  const webBase = env.SUPDANCE_PLUGIN_WEB_BASE ?? "/supdance-studio";
  const callback = new URL(webBase + "/oauth/callback", webOrigin);
  if (callback.origin !== webOrigin || (!local && callback.protocol !== "https:") ||
      !/^\/[a-z][a-z0-9-]{1,62}\/oauth\/callback$/.test(callback.pathname)) {
    throw new Error("Invalid Supdance website callback");
  }
  const jwksPath = z.string().min(1).parse(env.SUPDANCE_PLUGIN_ISSUER_JWKS);
  return {
    local, origin, issuer, base, resource: origin + "/mcp", webId, webSecret, introspectionId,
    introspectionSecret, cookieKey, callback: callback.href,
    jwks: JSON.parse(readFileSync(jwksPath, "utf8")) as Configuration["jwks"],
    port: z.coerce.number().int().min(1).max(65535).parse(env.SUPDANCE_PLUGIN_ISSUER_PORT || "8788"),
    database: env.SUPDANCE_PLUGIN_ISSUER_DATABASE || "./data/issuer.sqlite",
  };
}
type IssuerConfig = ReturnType<typeof issuerConfiguration>;

export function createIssuer(config: IssuerConfig) {
  const store = issuerStore(config.database);

  async function siteUser(req: IncomingMessage) {
    const cookies = (req.headers.cookie || "").split(";").map((part) => part.trim());
    const session = cookies.filter((part) => /^open_ai_canvas_session=[a-f0-9]{32}\.[a-f0-9]{64}$/.test(part));
    if (session.length !== 1) return null;
    const response = await fetch(config.origin + "/api/auth/session", {
      headers: { cookie: session[0], accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Supdance account service unavailable");
    return identityResponse.parse(await response.json()).data.user?.id ?? null;
  }

  const policy = interactionPolicy.base();
  policy.get("login")?.checks.add(new interactionPolicy.Check(
    "supdance_session_changed", "The active Supdance account must match the authorization session",
    async (ctx) => {
      const subject = ctx.oidc.session?.accountId;
      return Boolean(subject && (await siteUser(ctx.req)) !== subject);
    },
  ), 0);

  const provider = new Provider(config.issuer, {
    adapter: store.adapter,
    jwks: config.jwks,
    clients: [
      { client_id: config.webId, client_secret: config.webSecret, redirect_uris: [config.callback],
        grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "client_secret_basic" },
      { client_id: config.introspectionId, client_secret: config.introspectionSecret,
        redirect_uris: [], grant_types: [], response_types: [], token_endpoint_auth_method: "client_secret_basic" },
    ],
    responseTypes: ["code"],
    clientAuthMethods: ["none", "client_secret_basic", "client_secret_post"],
    scopes: ["openid", "offline_access", ...studioScopes],
    pkce: { required: () => true },
    ttl: { Interaction: 600, Session: 3600, AuthorizationCode: 120, AccessToken: 1800, RefreshToken: 86400, Grant: 86400 },
    cookies: {
      keys: [config.cookieKey],
      names: { session: "supdance_as_session", interaction: "supdance_as_flow", resume: "supdance_as_resume" },
      long: { secure: !config.local, httpOnly: true, sameSite: "lax", path: config.base },
      short: { secure: !config.local, httpOnly: true, sameSite: "lax" },
    },
    interactions: { policy, url: (_ctx, interaction) => config.base + "/interaction/" + interaction.uid },
    async findAccount(_ctx, subject) {
      return { accountId: subject, claims: async () => ({ sub: subject }) };
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      registration: { enabled: true, issueRegistrationAccessToken: false },
      introspection: { enabled: true, allowedPolicy: (_ctx, client, token) =>
        client.clientId === config.introspectionId && token.kind === "AccessToken" && token.aud === config.resource },
      revocation: { enabled: true, allowedPolicy: (_ctx, client, token) => client.clientId === token.clientId },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => config.resource,
        getResourceServerInfo(_ctx, resource) {
          if (resource !== config.resource) throw new errors.InvalidTarget("Unknown Supdance resource");
          return { scope: studioScopes.join(" "), audience: config.resource, accessTokenFormat: "opaque", accessTokenTTL: 1800 };
        },
      },
    },
    extraClientMetadata: {
      properties: [clientPolicyField],
      validator(ctx, _key, _value, metadata) {
        if (!ctx) return;
        const uris = metadata.redirect_uris ?? [];
        if (uris.length !== 1 || !isApprovedRedirect(uris[0]) ||
            metadata.grant_types?.some((grant) => grant !== "authorization_code" && grant !== "refresh_token") ||
            metadata.response_types?.some((type) => type !== "code")) {
          throw new errors.InvalidClientMetadata("Register an OpenAI or Codex authorization-code callback");
        }
      },
    },
  });
  provider.proxy = !config.local;
  const oauth = provider.callback();
  const loginPage = config.origin + "/login";
  let registrations = 0;
  let reset = Date.now() + 600000;

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "/", config.origin);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method === "GET" && url.pathname === "/healthz") return reply(res, 200, "ok");
    if (!config.local && req.headers.host !== new URL(config.origin).host) return reply(res, 404, "Not found");
    const discovery = url.pathname === "/.well-known/oauth-authorization-server" + config.base;
    if (discovery) req.url = "/.well-known/openid-configuration";
    else if (url.pathname.startsWith(config.base + "/")) req.url = url.pathname.slice(config.base.length) + url.search;
    else return reply(res, 404, "Not found");
    Object.assign(req, { baseUrl: config.base });

    if (req.url === "/reg" && req.method === "POST") {
      if (Date.now() >= reset) {
        registrations = 0;
        reset = Date.now() + 600000;
      }
      if (++registrations > 120) return reply(res, 429, "Registration rate exceeded");
    }
    const match = /^\/interaction\/([\w-]{1,128})$/.exec(req.url);
    if (!match) return oauth(req, res);
    if (req.method !== "GET" && req.method !== "POST") return reply(res, 405, "Method not allowed");
    const interaction = await provider.interactionDetails(req, res);
    if (interaction.uid !== match[1]) return reply(res, 400, "Invalid authorization request");
    const subject = await siteUser(req);
    if (!subject) {
      return page(res, "Sign in to Supdance / 登录 Supdance", `
        <p>Sign in with your Supdance account, then return to this window to continue.</p>
        <p>请先登录 Supdance，再返回此窗口继续。</p>
        <p><a target="_blank" rel="noopener noreferrer" href="${loginPage}">Open Supdance login / 打开登录页</a></p>
        <p><a href="${config.base}/interaction/${match[1]}">Continue / 继续</a></p>`);
    }
    const prompt = interaction.prompt.name;
    if (prompt !== "login" && prompt !== "consent") return reply(res, 400, "Unsupported authorization request");
    const proof = createHmac("sha256", config.cookieKey).update(JSON.stringify([interaction.uid, prompt, subject])).digest("hex");
    if (req.method === "GET") {
      const clientId = String(interaction.params.client_id);
      const redirect = new URL(String(interaction.params.redirect_uri));
      const clientName = clientId === config.webId ? "Supdance Studio" : redirect.protocol === "http:" ? "Codex" : "ChatGPT";
      const permissions = String(interaction.params.scope || "").split(/\s+/).filter((scope) => studioScopes.some((allowed) => allowed === scope));
      const heading = prompt === "login" ? "Continue with Supdance / 使用 Supdance 继续" : "Authorize Supdance / 授权 Supdance";
      return page(res, heading, `
        <p>Continue to ${clientName} with your signed-in Supdance account.</p>
        <p>将当前 Supdance 账号连接到 ${clientName}。</p>
        <ul>${permissions.map((scope) => `<li>${scope}</li>`).join("")}</ul>
        <p>Canvas changes still require separate confirmation. 画布改动仍需逐次确认。</p>
        <form method="post" action="${config.base}/interaction/${match[1]}">
          <input type="hidden" name="proof" value="${proof}">
          <button name="decision" value="allow">${prompt === "login" ? "Continue / 继续" : "Authorize / 授权"}</button>
          <button name="decision" value="deny">Cancel / 取消</button>
        </form>`);
    }
    if (req.headers.origin !== config.origin || !req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
      return reply(res, 403, "Invalid confirmation");
    }
    const input = await interactionForm(req);
    const supplied = input.get("proof") || "";
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(proof), Buffer.from(supplied))) {
      return reply(res, 403, "Invalid confirmation");
    }
    if (input.get("decision") === "deny") {
      return provider.interactionFinished(req, res, { error: "access_denied", error_description: "User cancelled authorization" },
        { mergeWithLastSubmission: false });
    }
    if (input.get("decision") !== "allow") return reply(res, 400, "Invalid confirmation");
    if (prompt === "login") {
      return provider.interactionFinished(req, res, { login: { accountId: subject } }, { mergeWithLastSubmission: false });
    }
    if (interaction.session?.accountId !== subject) return reply(res, 403, "The Supdance account changed. Start authorization again.");
    const grant = interaction.grantId ? await provider.Grant.find(interaction.grantId) :
      new provider.Grant({ accountId: subject, clientId: String(interaction.params.client_id) });
    if (!grant) return reply(res, 400, "Authorization expired. Start again.");
    const oidcScopes = interaction.prompt.details.missingOIDCScope as string[] | undefined;
    if (oidcScopes?.length) grant.addOIDCScope(oidcScopes.join(" "));
    const resourceScopes = interaction.prompt.details.missingResourceScopes as Record<string, string[]> | undefined;
    const approved = resourceScopes?.[config.resource];
    if (approved?.length) grant.addResourceScope(config.resource, approved.join(" "));
    return provider.interactionFinished(req, res, { consent: { grantId: await grant.save() } }, { mergeWithLastSubmission: true });
  }

  const server = createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      const status = error instanceof errors.OIDCProviderError ? 400 : 503;
      if (!res.headersSent) reply(res, status, status === 400 ? "Authorization expired. Start again." : "Supdance authorization is temporarily unavailable.");
      else res.end();
    });
  });
  server.once("close", store.close);
  return server;
}

function isApprovedRedirect(uri: string) {
  if (uri === mcpCallback) return true;
  return /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9]\d{0,4}\/callback$/.test(uri);
}

async function interactionForm(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > 2048) throw new errors.InvalidRequest("Invalid confirmation");
  }
  return new URLSearchParams(body);
}

function reply(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function page(res: ServerResponse, title: string, content: string) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Supdance</title><main><h1>${title}</h1>${content}</main></html>`);
}
