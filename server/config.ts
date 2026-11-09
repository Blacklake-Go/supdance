export function configuration(env = process.env) {
  const local = env.SUPDANCE_PLUGIN_DEV === "1";
  function url(name: string, fallback?: string) {
    const value = env["SUPDANCE_PLUGIN_" + name] || fallback;
    if (!value) return undefined;
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.hash || parsed.search ||
        (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname)))) {
      throw new Error("Invalid URL in SUPDANCE_PLUGIN_" + name);
    }
    return name === "OAUTH_ISSUER" ? value : parsed.href.replace(/\/$/, "");
  }
  const port = Number(env.SUPDANCE_PLUGIN_PORT || "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid plugin port");
  const origin = url("ORIGIN", local ? `http://127.0.0.1:${port}` : undefined);
  if (!origin || new URL(origin).origin !== origin) throw new Error("A canonical plugin origin is required");
  const webOrigin = url("WEB_ORIGIN", origin);
  if (!webOrigin || new URL(webOrigin).origin !== webOrigin) throw new Error("Invalid web origin");
  const webBase = env.SUPDANCE_PLUGIN_WEB_BASE ?? (local ? "" : "/supdance-studio");
  if (webBase && (!/^\/[a-z][a-z0-9-]{1,62}$/.test(webBase) || ["/mcp", "/api", "/oauth"].includes(webBase))) {
    throw new Error("Invalid plugin web base");
  }
  const issuer = url("OAUTH_ISSUER");
  const authorization = url("OAUTH_AUTHORIZATION");
  const token = url("OAUTH_TOKEN");
  const introspection = url("OAUTH_INTROSPECTION");
  const introspectionId = env.SUPDANCE_PLUGIN_INTROSPECTION_ID;
  const introspectionSecret = env.SUPDANCE_PLUGIN_INTROSPECTION_SECRET;
  const webId = env.SUPDANCE_PLUGIN_WEB_CLIENT_ID;
  const webSecret = env.SUPDANCE_PLUGIN_WEB_CLIENT_SECRET;
  const sessionKey = env.SUPDANCE_PLUGIN_SESSION_KEY;
  if (sessionKey && !/^[a-f0-9]{64}$/i.test(sessionKey)) throw new Error("Session key requires 32 bytes in hex");
  const bridge = url("BRIDGE_URL");
  const bridgeSecret = env.SUPDANCE_PLUGIN_BRIDGE_SECRET;
  const oauth = issuer && authorization && token && introspection && introspectionId && introspectionSecret && webId && webSecret && sessionKey
    ? { issuer, authorization, token, introspection, introspectionId, introspectionSecret, webId, webSecret, sessionKey }
    : undefined;
  if (!local && (!oauth || !bridge || !bridgeSecret)) throw new Error("Production requires OAuth and the Supdance partner API");
  const media = env.SUPDANCE_PLUGIN_MEDIA_ENABLED === "1";
  return {
    local, port, origin, webOrigin, webBase, resource: origin + "/mcp", oauth,
    bridge: bridge && bridgeSecret ? { url: bridge, secret: bridgeSecret } : undefined,
    database: env.SUPDANCE_PLUGIN_DATABASE || "./data/plugin.sqlite",
    media,
    mcpOrigins: new Set([origin, "https://chatgpt.com", "https://platform.openai.com"]),
  };
}
export type Config = ReturnType<typeof configuration>;
