import { z } from "zod";
import { readFileSync } from "node:fs";
import { Actions } from "./actions";
import { Auth, requireScope, type Identity } from "./auth";
import { Bridge } from "./bridge";
import { configuration, type Config } from "./config";
import { Conversations } from "./conversations";
import { openDatabase } from "./database";
import { asFailure, Failure } from "./errors";
import { mcp } from "./mcp";
import { action, draft, ID, mediaKind, text, turnInput } from "../shared/contracts";
import { version } from "../package.json";

export function application(config: Config, assets: { index: string; app: string; css: string; widget: string; icon: Uint8Array<ArrayBuffer> }) {
  const db = openDatabase(config.database);
  const auth = new Auth(config, db), bridge = new Bridge(config);
  const actions = new Actions(config, db, bridge), conversations = new Conversations(db, bridge);
  let budget = 180, reset = 0;
  const accounts = new Map<string, number>();
  function rate(actor?: Identity) {
    if (Date.now() >= reset) { reset = Date.now() + 60000; budget = 180; accounts.clear(); }
    if (!actor) {
      if (--budget < 0) throw new Failure(429, "rate_limited", true);
      return;
    }
    const used = (accounts.get(actor.owner) ?? 0) + 1;
    if (used > 60) throw new Failure(429, "rate_limited", true);
    accounts.set(actor.owner, used);
  }
  const deps = { config, auth, db, bridge, actions, widget: assets.widget };
  const html = { "content-type": "text/html; charset=utf-8" };
  const index = assets.index.replace('content="__SUPDANCE_BASE__"', `content="${config.webBase}"`)
    .replace(/__SUPDANCE_BASE__\//g, config.webBase + "/");
  const noContent = () => new Response(null, { status: 204 });
  const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });

  async function route(req: Request) {
    const url = new URL(req.url);
    const resourcePath = url.pathname === "/mcp" || url.pathname.startsWith("/.well-known/oauth-protected-resource");
    const method = req.method;
    if (method === "GET" && url.pathname === "/healthz") return json({ name: "Supdance", version, status: "ok" });
    if (method === "GET" && url.pathname === "/readyz") {
      db.query("SELECT 1").get();
      const partnerReady = Boolean(config.oauth) && await bridge.ready();
      return json({ configured: Boolean(config.oauth && config.bridge), partnerReady }, partnerReady ? 200 : 503);
    }
    if (!config.local) {
      const expectedHost = new URL(resourcePath ? config.origin : config.webOrigin).host;
      if (url.host !== expectedHost) throw new Failure(404, "not_found");
    }
    if (method === "GET" && (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp")) {
      return json(auth.metadata());
    }
    if (!resourcePath && config.webBase && url.pathname !== config.webBase && !url.pathname.startsWith(config.webBase + "/")) {
      throw new Failure(404, "not_found");
    }
    const path = resourcePath ? url.pathname : url.pathname.slice(config.webBase.length) || "/";
    if (method === "GET") {
      if (path === "/" || /^\/review\/[\w-]{1,128}$/.test(path)) return new Response(index, { headers: html });
      if (path === "/app.js") return new Response(assets.app, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      if (path === "/styles.css") return new Response(assets.css, { headers: { "content-type": "text/css; charset=utf-8" } });
      if (path === "/icon.png") return new Response(assets.icon, { headers: { "content-type": "image/png" } });
    }
    if (path === "/mcp") {
      const origin = req.headers.get("origin");
      if (origin && !config.mcpOrigins.has(origin)) throw new Failure(403, "origin_forbidden");
      if (method === "GET" && !req.headers.has("authorization")) {
        return json({ code: "login_required" }, 401, { "www-authenticate": auth.challenge() });
      }
      if (method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
      rate();
      let actor: Identity | undefined;
      const header = req.headers.get("authorization");
      if (header) {
        try {
          if (!/^Bearer /i.test(header)) throw new Failure(401, "invalid_token");
          actor = await auth.verify(header.slice(7), "mcp");
          rate(actor);
        } catch (error) {
          if (error instanceof Failure && error.status === 401) {
            return json({ code: error.code }, 401, { "www-authenticate": auth.challenge(error.code) });
          }
          throw error;
        }
      }
      const request = await body(req);
      const { server, transport } = mcp(deps, actor);
      try {
        await server.connect(transport);
        return await transport.handleRequest(req, { parsedBody: request });
      } finally {
        await server.close();
      }
    }
    if (path === "/oauth/login" && method === "GET") {
      rate();
      return auth.start(url.searchParams.get("return") || "/");
    }
    if (path === "/oauth/callback" && method === "GET") {
      rate();
      return auth.callback(req, url);
    }
    if (!path.startsWith("/api/")) throw new Failure(404, "not_found");
    if (method !== "GET" && req.headers.get("origin") !== config.webOrigin) throw new Failure(403, "origin_forbidden");
    if (path === "/api/logout" && method === "POST") return auth.logout(req);
    rate();
    const actor = await auth.browser(req);
    rate(actor);
    if (path === "/api/me" && method === "GET") return json({ scopes: [...actor.scopes], media: config.media });
    if (path === "/api/models" && method === "GET") {
      requireScope(actor, "story:generate");
      return json(await bridge.models(actor));
    }
    if (path === "/api/projects" && method === "GET") {
      requireScope(actor, "projects:read");
      return json(await bridge.projects(actor));
    }
    const mediaModels = path.match(/^\/api\/media-models\/(image|video|music)$/);
    if (mediaModels && method === "GET") {
      requireScope(actor, "media:generate");
      if (!config.media) throw new Failure(403, "media_disabled");
      return json(await bridge.mediaModels(actor, mediaKind.parse(mediaModels[1])));
    }
    const taskRoute = path.match(/^\/api\/projects\/([\w-]{1,128})\/tasks\/([\w-]{1,128})$/);
    if (taskRoute && method === "GET") {
      requireScope(actor, "media:read");
      if (!config.media) throw new Failure(403, "media_disabled");
      return json(await bridge.task(actor, taskRoute[1], taskRoute[2]));
    }
    const canvasesRoute = path.match(/^\/api\/projects\/([\w-]{1,128})\/canvases$/);
    if (canvasesRoute && method === "GET") {
      requireScope(actor, "canvas:read");
      return json(await bridge.canvases(actor, canvasesRoute[1]));
    }
    const canvasRoute = path.match(/^\/api\/projects\/([\w-]{1,128})\/canvases\/([\w-]{1,128})$/);
    if (canvasRoute && method === "GET") {
      requireScope(actor, "canvas:read");
      return json(await bridge.canvas(actor, canvasRoute[1], canvasRoute[2]));
    }
    if (path === "/api/approvals" && method === "POST") {
      const { requestId, payload } = z.strictObject({ requestId: ID, payload: action }).parse(await body(req));
      return json(await actions.preview(actor, requestId, payload), 201);
    }
    const approvalRoute = path.match(/^\/api\/approvals\/([\w-]{1,128})(?:\/(decision|execute))?$/);
    if (approvalRoute) {
      const [, id, op] = approvalRoute;
      if (method === "GET" && !op) return json(actions.get(actor, id));
      if (method === "POST" && op === "decision") {
        const { approve } = z.strictObject({ approve: z.boolean() }).parse(await body(req));
        return json(actions.decide(actor, id, approve));
      }
      if (method === "POST" && op === "execute") return json(await actions.execute(actor, id));
    }
    if (path === "/api/conversations") {
      if (method === "GET") return json(conversations.list(actor, (url.searchParams.get("search") || "").slice(0, 240)));
      if (method === "POST") {
        const { title, projectId } = z.strictObject({ title: text(240), projectId: ID.optional() }).parse(await body(req));
        return json(await conversations.create(actor, title, projectId), 201);
      }
    }
    const match = path.match(/^\/api\/conversations\/([\w-]{1,128})(?:\/(draft|turns|stop|project|revision))?$/);
    if (match) {
      const [, id, op] = match;
      if (method === "GET" && !op) return json(conversations.detail(actor, id));
      if (method === "DELETE" && !op) { conversations.remove(actor, id); return noContent(); }
      if (method === "PUT" && op === "draft") { conversations.save(actor, id, draft.parse(await body(req))); return noContent(); }
      if (method === "PUT" && op === "project") {
        const { projectId } = z.strictObject({ projectId: ID.nullable() }).parse(await body(req));
        return json(await conversations.setProject(actor, id, projectId));
      }
      if (method === "POST" && op === "stop") { conversations.stop(actor, id); return noContent(); }
      if (method === "POST" && op === "revision") {
        const { turnId, artifact } = z.strictObject({ turnId: ID, artifact: z.record(z.string(), z.unknown()) }).parse(await body(req));
        return json(conversations.revise(actor, id, turnId, artifact), 201);
      }
      if (method === "POST" && op === "turns") {
        return new Response(conversations.stream(actor, id, turnInput.parse(await body(req))), {
          headers: { "content-type": "application/x-ndjson; charset=utf-8", "x-accel-buffering": "no" },
        });
      }
    }
    throw new Failure(404, "not_found");
  }

  return {
    db, fetch: async (req: Request) => {
      let response: Response;
      try { response = await route(req); }
      catch (error) {
        const failure = asFailure(error);
        response = json({ code: failure.code, retryable: failure.retryable }, failure.status);
      }
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "no-referrer");
      if (!config.local) headers.set("strict-transport-security", "max-age=31536000");
      headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
      return new Response(response.body, { status: response.status, headers });
    },
  };
}

async function body(req: Request) {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Failure(415, "json_required");
  if (Number(req.headers.get("content-length")) > 512000) throw new Failure(413, "request_too_large");
  const data = await req.text(); // Bun's maxRequestBodySize also applies to chunked requests.
  if (Buffer.byteLength(data) > 512000) throw new Failure(413, "request_too_large");
  try { return JSON.parse(data); } catch { throw new Failure(400, "invalid_json"); }
}

if (import.meta.main) {
  const config = configuration();
  const assets = {
    index: readFileSync("dist/index.html", "utf8"), app: readFileSync("dist/app.js", "utf8"),
    css: readFileSync("dist/styles.css", "utf8"), widget: readFileSync("dist/widget.html", "utf8"),
    icon: Uint8Array.from(readFileSync("plugin/assets/icon.png")),
  };
  const { fetch } = application(config, assets);
  const server = Bun.serve({ hostname: config.local ? "127.0.0.1" : "0.0.0.0", port: config.port, fetch,
    maxRequestBodySize: 512000, idleTimeout: 120 });
  console.log("Supdance", version, server.url.href);
}
