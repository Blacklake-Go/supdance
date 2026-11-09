import { z } from "zod";
import { scopes } from "../shared/contracts";

const mcp = new URL(process.env.SUPDANCE_PLUGIN_PACKAGE_MCP_URL || "https://www.supdance.com/mcp");
const issuer = new URL(process.env.SUPDANCE_PLUGIN_OAUTH_ISSUER || "https://openid.supdance.com");
const provided = !!process.env.SUPDANCE_PLUGIN_PACKAGE_OAUTH_CLIENT_ID;
const problems: string[] = [];
for (const target of [mcp, issuer]) {
  if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) {
    throw new Error("Preflight requires HTTPS URLs without credentials, queries or fragments");
  }
}

const metadata = z.object({
  issuer: z.string(), authorization_endpoint: z.url({ protocol: /^https$/ }),
  token_endpoint: z.url({ protocol: /^https$/ }), introspection_endpoint: z.url({ protocol: /^https$/ }),
  registration_endpoint: z.url({ protocol: /^https$/ }).optional(),
  code_challenge_methods_supported: z.array(z.string()).default([]),
  scopes_supported: z.array(z.string()).default([]),
  authorization_response_iss_parameter_supported: z.boolean().default(false),
});

async function request(url: URL | string, options: RequestInit = {}) {
  return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(8000) });
}

async function checkIssuer() {
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  for (const url of [
    issuer.origin + "/.well-known/oauth-authorization-server" + path,
    issuer.origin + path + "/.well-known/openid-configuration",
  ]) {
    try {
      const response = await request(url);
      if (!response.ok) continue;
      const config = metadata.parse(await response.json());
      if (config.issuer !== (process.env.SUPDANCE_PLUGIN_OAUTH_ISSUER || "https://openid.supdance.com")) {
        problems.push("Authorization server issuer differs from the configured issuer.");
      }
      if (!provided && !config.registration_endpoint) problems.push("OAuth discovery has no DCR endpoint. Register a dedicated provided client or enable DCR.");
      if (!config.code_challenge_methods_supported.includes("S256")) problems.push("OAuth discovery does not advertise PKCE S256.");
      if (!config.authorization_response_iss_parameter_supported) problems.push("OAuth discovery does not advertise RFC 9207 callback issuer identification required by the website flow.");
      const missing = scopes.filter((scope) => !scope.startsWith("media:") && !config.scopes_supported.includes(scope));
      if (missing.length) problems.push("OAuth discovery does not advertise the plugin scopes: " + missing.join(", "));
      console.log("Issuer discovery:", url);
      return;
    } catch { /* try the other standard discovery path */ }
  }
  problems.push("No valid OAuth or OIDC discovery document was reachable.");
}

async function checkMcp() {
  try {
    const response = await request(mcp);
    const challenge = response.headers.get("www-authenticate");
    if (response.status !== 401 || !challenge?.startsWith("Bearer ")) {
      problems.push("Public MCP endpoint returned HTTP " + response.status + " without its OAuth challenge.");
      return;
    }
    const raw = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
    if (!raw || new URL(raw).origin !== mcp.origin) {
      problems.push("MCP challenge has no same-origin protected-resource URL.");
      return;
    }
    const result = await request(raw);
    const payload = z.object({ resource: z.string(), authorization_servers: z.array(z.string()) }).parse(await result.json());
    if (!result.ok || payload.resource !== mcp.href || !payload.authorization_servers.some((value) => new URL(value).href === issuer.href)) {
      problems.push("MCP protected-resource metadata does not match the intended MCP URL and issuer.");
    }
  } catch {
    problems.push("Public MCP challenge or resource discovery was unreachable or malformed.");
  }
}

await Promise.all([checkIssuer(), checkMcp()]);
for (const issue of problems) console.error(issue);
if (problems.length) process.exitCode = 1;
else console.log("Discovery checks passed. Run a real PKCE resource-bound flow, revocation and Supdance ACL tests before release.");
