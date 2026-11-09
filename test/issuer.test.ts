import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createIssuer } from "../server/issuer";

test("Supdance issuer binds PKCE to the account, client and resource, and revokes its access token", async () => {
  const accountSession = "qa-session-" + "s".repeat(28);
  let upstream = "";
  const main = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/auth/session") {
        const signedIn = req.headers.get("cookie") === "open_ai_canvas_session=" + accountSession;
        return Response.json({ code: 0, data: { user: signedIn ? { id: "qa-user-1" } : null } });
      }
      return fetch(upstream + url.pathname + url.search, { method: req.method,
        headers: { ...Object.fromEntries(req.headers), host: url.host }, body: req.body, redirect: "manual" });
    },
  });
  const origin = main.url.origin, base = "/supdance-auth", issuer = origin + base, resource = origin + "/mcp";
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "jwk" });
  const provider = createIssuer({
    origin, base, issuer, resource, local: true, port: 0, database: ":memory:",
    webId: "studio-browser", webSecret: "a".repeat(64), callback: origin + "/supdance-studio/oauth/callback",
    introspectionId: "studio-resource", introspectionSecret: "b".repeat(64), cookieKey: "c".repeat(64),
    jwks: { keys: [privateKey] },
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  upstream = "http://127.0.0.1:" + (provider.address() as AddressInfo).port;
  const cookies = new Map<string, string>();
  const call = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", [...cookies].map(([key, value]) => key + "=" + value).join("; "));
    const response = await fetch(new URL(url, origin), { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(";")[0].split("=");
      if (value) cookies.set(key, value);
      else cookies.delete(key);
    }
    return response;
  };
  const post = (url: string, values: Record<string, string>, headers?: HeadersInit) =>
    call(url, { method: "POST", body: new URLSearchParams(values), headers });
  const register = (redirect: string) => call(issuer + "/reg", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: "none",
      application_type: "native", grant_types: ["authorization_code"], response_types: ["code"] }),
  });
  try {
    const meta = await call("/.well-known/oauth-authorization-server" + base).then((r) => r.json());
    expect(meta.issuer).toBe(issuer);
    expect(meta.authorization_endpoint).toBe(issuer + "/auth");
    expect(meta.authorization_response_iss_parameter_supported).toBe(true);
    expect((await register("https://unrelated.example/callback")).status).toBe(400);
    const redirect = "http://127.0.0.1:24531/callback";
    const registered = await register(redirect);
    expect(registered.status).toBe(201);
    const { client_id } = await registered.json();
    const verifier = "s".repeat(43);
    const params = new URLSearchParams({
      client_id, redirect_uri: redirect, response_type: "code", scope: "projects:read", resource, state: "test-state",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    });
    const initial = await call(issuer + "/auth?" + params);
    const login = initial.headers.get("location")!;
    expect(new URL(login, origin).pathname).toContain(base + "/interaction/");
    expect(await call(login).then((r) => r.text())).toContain("Open Supdance login");
    cookies.set("open_ai_canvas_session", accountSession);
    const proof = (html: string) => html.match(/name="proof" value="([a-f0-9]{64})"/)?.[1] || "";
    const loginProof = proof(await call(login).then((r) => r.text()));
    expect(loginProof).toHaveLength(64);
    expect((await post(login, { decision: "allow", proof: loginProof }, { origin: "https://unrelated.example" })).status).toBe(403);
    const resume = await post(login, { decision: "allow", proof: loginProof }, { origin });
    const consent = await call(resume.headers.get("location")!);
    const consentUrl = consent.headers.get("location")!;
    expect(new URL(consentUrl, origin).pathname).toContain(base + "/interaction/");
    const consentProof = proof(await call(consentUrl).then((r) => r.text()));
    expect(consentProof).toHaveLength(64);
    const approved = await post(consentUrl, { decision: "allow", proof: consentProof }, { origin });
    const completed = await call(approved.headers.get("location")!);
    const callback = new URL(completed.headers.get("location")!);
    expect(callback.searchParams.get("iss")).toBe(issuer);
    expect(callback.searchParams.get("state")).toBe("test-state");
    const code = callback.searchParams.get("code")!;
    expect(code).toBeTruthy();
    const exchange = { grant_type: "authorization_code", code, code_verifier: verifier, resource,
      redirect_uri: redirect, client_id };
    const valid = await post(meta.token_endpoint, exchange);
    expect(valid.status).toBe(200);
    const { access_token } = await valid.json();
    const basic = "Basic " + Buffer.from("studio-resource:" + "b".repeat(64)).toString("base64");
    const token = { token: access_token, token_type_hint: "access_token" };
    const introspect = () => post(meta.introspection_endpoint, token, { authorization: basic }).then((r) => r.json());
    expect(await introspect()).toMatchObject({
      active: true, iss: issuer, aud: resource, sub: "qa-user-1", client_id, token_type: "Bearer", scope: "projects:read",
    });
    expect(await post(meta.introspection_endpoint, { ...token, client_id }).then((r) => r.json())).toMatchObject({ active: false });
    expect((await post(meta.revocation_endpoint, { ...token, client_id })).status).toBe(200);
    expect(await introspect()).toEqual({ active: false });
    expect((await post(meta.token_endpoint, exchange)).status).toBe(400);
  } finally {
    provider.closeAllConnections();
    provider.close();
    main.stop(true);
  }
});
