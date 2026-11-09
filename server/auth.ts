import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { scopes, type Scope } from "../shared/contracts";
import type { Config } from "./config";
import type { DB } from "./database";
import { Failure } from "./errors";

export type Identity = { owner: string; subject: string; scopes: Set<string>; expires: number };
const tokenInfo = z.object({
  active: z.literal(true), iss: z.string(), sub: z.string().min(1).max(256),
  aud: z.union([z.string(), z.array(z.string()).max(8)]), exp: z.number().int(),
  nbf: z.number().int().optional(), client_id: z.string().min(1), scope: z.string(),
  token_type: z.string(),
});
const random = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const formValue = (value: string) => new URLSearchParams({ x: value }).toString().slice(2);
const basic = (id: string, secret: string) =>
  "Basic " + Buffer.from(formValue(id) + ":" + formValue(secret)).toString("base64");

export class Auth {
  constructor(private config: Config, private db: DB) {}

  private get oauth() {
    if (!this.config.oauth) throw new Failure(503, "oauth_unconfigured");
    return this.config.oauth;
  }

  get metadataUrl() { return this.config.origin + "/.well-known/oauth-protected-resource/mcp"; }

  challenge(code?: string, scope?: Scope) {
    return `Bearer resource_metadata="${this.metadataUrl}"` +
      (code ? `, error="${code}"` : "") + (scope ? `, scope="${scope}"` : "");
  }

  private get supportedScopes() { return scopes.filter((scope) => this.config.media || !scope.startsWith("media:")); }

  metadata() {
    return { resource: this.config.resource, authorization_servers: [this.oauth.issuer],
      scopes_supported: this.supportedScopes, bearer_methods_supported: ["header"], resource_name: "Supdance" };
  }

  async verify(token: string, channel: "web" | "mcp"): Promise<Identity> {
    if (!/^[A-Za-z0-9._~+/-]{1,8192}={0,2}$/.test(token)) throw new Failure(401, "invalid_token");
    const oauth = this.oauth;
    let info;
    try {
      const result = await fetch(oauth.introspection, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(6000),
        headers: { authorization: basic(oauth.introspectionId, oauth.introspectionSecret),
          "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
      });
      if (!result.ok) throw new Error("introspection");
      info = tokenInfo.safeParse(await result.json());
    } catch {
      throw new Failure(503, "oauth_unavailable", true);
    }
    const now = Math.floor(Date.now() / 1000);
    if (!info.success) throw new Failure(401, "invalid_token");
    const claims = info.data;
    if (claims.iss !== oauth.issuer || ![claims.aud].flat().includes(this.config.resource) ||
        claims.exp <= now || (claims.nbf ?? 0) > now ||
        claims.token_type.toLowerCase() !== "bearer" ||
        (channel === "web" ? claims.client_id !== oauth.webId : claims.client_id === oauth.webId)) {
      throw new Failure(401, "invalid_token");
    }
    return {
      owner: digest(JSON.stringify([claims.iss, claims.sub])), subject: claims.sub,
      scopes: new Set(claims.scope.split(/\s+/)), expires: claims.exp * 1000,
    };
  }

  private cookieName(name: string) { return this.config.local ? "supdance_" + name : "__Host-supdance_" + name; }

  private cookie(req: Request, name: string) {
    const value = req.headers.get("cookie")?.split(/;\s*/).find((part) => part.startsWith(this.cookieName(name) + "="));
    return value?.split("=")[1];
  }

  private setCookie(name: string, value: string, age: number) {
    return `${this.cookieName(name)}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${this.config.local ? "" : "; Secure"}`;
  }

  private redirect(url: string, cookies: string[]) {
    const headers = new Headers({ Location: url });
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return new Response(null, { status: 303, headers });
  }

  start(target: string) {
    const oauth = this.oauth;
    const id = random(), state = random(), verifier = random();
    const destination = /^\/review\/[\w-]{1,128}$/.test(target) ? target : "/";
    this.db.run("DELETE FROM oauth_flows WHERE expires < ?", [Date.now()]);
    this.db.run("INSERT INTO oauth_flows VALUES(?,?,?,?,?)", [digest(id), state, verifier, destination, Date.now() + 600000]);
    const url = new URL(oauth.authorization);
    url.search = new URLSearchParams({
      response_type: "code", client_id: oauth.webId, redirect_uri: this.config.origin + "/oauth/callback",
      state, code_challenge: digest(verifier), code_challenge_method: "S256", scope: this.supportedScopes.join(" "),
      resource: this.config.resource,
    }).toString();
    return this.redirect(url.href, [this.setCookie("flow", id, 600)]);
  }

  async callback(req: Request, url: URL) {
    const oauth = this.oauth;
    const id = this.cookie(req, "flow");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!id || !code || code.length > 4096 || !state || url.searchParams.get("iss") !== oauth.issuer) {
      throw new Failure(400, "oauth_callback_invalid");
    }
    const flow = this.db.query<{ verifier: string; target: string }, [string, string, number]>(
      "DELETE FROM oauth_flows WHERE id=? AND state=? AND expires>? RETURNING verifier,target",
    ).get(digest(id), state, Date.now());
    if (!flow) throw new Failure(400, "oauth_callback_invalid");
    let data;
    try {
      const response = await fetch(oauth.token, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(6000),
        headers: { authorization: basic(oauth.webId, oauth.webSecret), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code", code, code_verifier: flow.verifier,
          redirect_uri: this.config.origin + "/oauth/callback", resource: this.config.resource,
        }),
      });
      if (!response.ok) throw new Error("token");
      data = z.object({ access_token: z.string().max(8192), token_type: z.string() }).parse(await response.json());
      if (data.token_type.toLowerCase() !== "bearer") throw new Error("token type");
    } catch { throw new Failure(502, "oauth_exchange_failed"); }
    const actor = await this.verify(data.access_token, "web");
    const age = Math.min(3600, Math.floor((actor.expires - Date.now()) / 1000));
    if (age < 1) throw new Failure(401, "invalid_token");
    const session = random();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(oauth.sessionKey, "hex"), iv);
    cipher.setAAD(Buffer.from(digest(session)));
    const encrypted = Buffer.concat([iv, cipher.update(data.access_token), cipher.final(), cipher.getAuthTag()]);
    this.db.transaction(() => {
      this.db.run("DELETE FROM web_sessions WHERE expires <= ? OR id=?", [Date.now(), digest(this.cookie(req, "session") || "")]);
      this.db.run("INSERT INTO web_sessions VALUES(?,?,?)", [digest(session), encrypted.toString("base64"), Date.now() + age * 1000]);
    })();
    return this.redirect(flow.target, [this.setCookie("flow", "", 0), this.setCookie("session", session, age)]);
  }

  async browser(req: Request) {
    const id = this.cookie(req, "session");
    if (!id) throw new Failure(401, "login_required");
    const key = digest(id);
    const row = this.db.query<{ token: string }, [string, number]>("SELECT token FROM web_sessions WHERE id=? AND expires>?").get(key, Date.now());
    if (!row) throw new Failure(401, "login_required");
    const data = Buffer.from(row.token, "base64");
    const cipher = createDecipheriv("aes-256-gcm", Buffer.from(this.oauth.sessionKey, "hex"), data.subarray(0, 12));
    cipher.setAAD(Buffer.from(key));
    cipher.setAuthTag(data.subarray(-16));
    let token: string;
    try { token = Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString(); }
    catch { throw new Failure(401, "login_required"); }
    return this.verify(token, "web");
  }

  logout(req: Request) {
    const id = this.cookie(req, "session");
    if (id) this.db.run("DELETE FROM web_sessions WHERE id=?", [digest(id)]);
    return new Response(null, { status: 204, headers: { "set-cookie": this.setCookie("session", "", 0) } });
  }
}

export function requireScope(actor: Identity, scope: Scope) {
  if (!actor.scopes.has(scope)) throw new Failure(403, "insufficient_scope");
}
