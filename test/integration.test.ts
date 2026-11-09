import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { approval } from "../shared/contracts";
import { fixture, sampleShot } from "./fixture";

type Fixture = Awaited<ReturnType<typeof fixture>>;
let env: Fixture;
afterEach(() => env?.stop());

async function client(token?: string) {
  const result = new Client({ name: "integration", version: "1.0.0" });
  await result.connect(new StreamableHTTPClientTransport(new URL("/mcp", env.origin), {
    requestInit: token ? { headers: { authorization: "Bearer " + token } } : undefined,
  }));
  return result;
}

async function browserLogin() {
  const initial = await fetch(env.origin + "/oauth/login", { redirect: "manual" });
  const flow = initial.headers.getSetCookie()[0].split(";")[0];
  const provider = await fetch(initial.headers.get("location")!, { redirect: "manual" });
  const callback = provider.headers.get("location")!;
  const session = await fetch(callback, { redirect: "manual", headers: { cookie: flow } });
  expect(session.status).toBe(303);
  expect((await fetch(callback, { redirect: "manual", headers: { cookie: flow } })).status).toBe(400);
  return session.headers.getSetCookie().find((value) => value.startsWith("supdance_session="))!.split(";")[0];
}

async function web(cookie: string, path: string, method = "GET", data?: unknown, origin = env.origin) {
  return fetch(env.origin + path, { method,
    headers: { cookie, origin, ...(data === undefined ? {} : { "content-type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

test("MCP SDK discovers typed OAuth tools and requests linking; rejects revoked, wrong audience, expired and web tokens", async () => {
  env = await fixture();
  const response = await fetch(env.origin + "/mcp");
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/mcp");
  const resource = await (await fetch(env.origin + "/.well-known/oauth-protected-resource/mcp")).json();
  expect(resource).toMatchObject({ resource: env.origin + "/mcp" });
  const anon = await client();
  const { tools } = await anon.listTools();
  expect(tools).toHaveLength(13);
  expect(tools.find((tool) => tool.name === "supdance_apply_canvas_changes")).toMatchObject({
    annotations: { readOnlyHint: false, idempotentHint: true }, outputSchema: { type: "object" },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["canvas:write"] }] },
  });
  const denied = await anon.callTool({ name: "supdance_list_projects", arguments: {} });
  expect(denied.isError).toBe(true);
  expect(denied._meta).toHaveProperty("mcp/www_authenticate");
  expect((await anon.readResource({ uri: "ui://supdance/review-v1.html" })).contents[0].mimeType).toBe("text/html;profile=mcp-app");
  const reader = await client("narrow-mcp");
  expect((await reader.callTool({ name: "supdance_generate_outline", arguments: { brief: "Short drama" } })).isError).toBe(true);
  for (const token of ["wrong-aud", "expired-mcp", "alice-web"]) {
    const invalid = await fetch(env.origin + "/mcp", { method: "POST", headers: { authorization: "Bearer " + token } });
    expect(invalid.status).toBe(401);
  }
  env.state.revoked = true;
  expect((await fetch(env.origin + "/mcp", { method: "POST", headers: { authorization: "Bearer alice-mcp" } })).status).toBe(401);
  await reader.close();
  await anon.close();
});

test("storyboard, ownership, durable approval, immutable payload, CSRF and concurrent commit", async () => {
  env = await fixture();
  const alice = await client("alice-mcp"), bob = await client("bob-mcp");
  const story = await alice.callTool({ name: "supdance_generate_storyboard", arguments: { brief: "Last train" } });
  expect(story.structuredContent).toMatchObject({ artifact: { shots: [sampleShot] } });
  expect((await bob.callTool({ name: "supdance_get_project", arguments: { projectId: "train" } })).isError).toBe(true);
  const payload = { requestId: "canvas-1", projectId: "train", canvasId: "board", revision: "r1", shots: [sampleShot] };
  const preview = await alice.callTool({ name: "supdance_preview_canvas_changes", arguments: payload });
  const item = approval.parse((preview.structuredContent as { approval: unknown }).approval);
  expect(item.status).toBe("pending");
  expect((await alice.callTool({ name: "supdance_preview_canvas_changes", arguments: { ...payload, shots: [{ ...sampleShot, action: "Different" }] } })).isError).toBe(true);
  const commit = () => alice.callTool({ name: "supdance_apply_canvas_changes", arguments: { reviewId: item.id } });
  expect((await commit()).isError).toBe(true);
  expect(env.state.commitCount).toBe(0);
  const cookie = await browserLogin();
  expect((await web(cookie, "/api/approvals/" + item.id + "/decision", "POST", { approve: true }, "https://evil.example")).status).toBe(403);
  expect((await web(cookie, "/api/approvals/" + item.id + "/decision", "POST", { approve: true })).status).toBe(200);
  await Promise.all([commit(), commit()]);
  expect(env.state.commitCount).toBe(1);
  expect(await (await web(cookie, "/api/approvals/" + item.id)).json()).toMatchObject({ status: "done", receipt: { nodeIds: ["shot-1"] } });
  expect((await alice.callTool({ name: "supdance_preview_canvas_changes", arguments: { ...payload, requestId: "stale" } })).isError).toBe(true);
  await alice.close(); await bob.close();
});

test("media holds a quote, handles a lost receipt without repeating the upstream write, and returns assets", async () => {
  env = await fixture(true);
  const alice = await client("alice-mcp");
  const result = await alice.callTool({ name: "supdance_generate_image", arguments: {
    requestId: "image-1", projectId: "train", model: "demo-image", prompt: "Courier at station",
  } });
  const item = approval.parse((result.structuredContent as { approval: unknown }).approval);
  expect(item.quote.credits).toBe(3);
  const cookie = await browserLogin(), path = "/api/approvals/" + item.id;
  expect((await web(cookie, path + "/decision", "POST", { approve: true })).status).toBe(200);
  env.state.failAfterCommit = true;
  expect(await (await web(cookie, path + "/execute", "POST")).json()).toMatchObject({ status: "running", error: "partner_unavailable" });
  env.app.db.run("UPDATE approvals SET lease_until=0 WHERE id=?", [item.id]);
  expect(await (await web(cookie, path + "/execute", "POST")).json()).toMatchObject({ status: "done", receipt: { task: { id: "task-1" } } });
  expect(env.state.commitCount).toBe(1);
  expect((await alice.callTool({ name: "supdance_get_task_status", arguments: { projectId: "train", taskId: "task-1" } })).structuredContent).toMatchObject({ task: { status: "succeeded", assetIds: ["asset-1"] } });
  await alice.close();
});

test("website OAuth session saves drafts, streams turns, resumes history, stops and signs out", async () => {
  env = await fixture();
  const cookie = await browserLogin();
  const conv = await (await web(cookie, "/api/conversations", "POST", { title: "Last train", projectId: "train" })).json() as { id: string };
  const path = "/api/conversations/" + conv.id;
  const draft = { text: "Start at the platform", skill: "chat", attachment: { name: "notes.md", text: "After midnight" } };
  expect((await web(cookie, path + "/draft", "PUT", draft)).status).toBe(204);
  expect(await (await web(cookie, path)).json()).toMatchObject({ draft });
  const stream = await web(cookie, path + "/turns", "POST", { ...draft, language: "en" });
  expect(stream.headers.get("content-type")).toContain("application/x-ndjson");
  expect(await stream.text()).toContain('"status":"done"');
  const restored = await (await web(cookie, path)).json() as { turns: { id: string; status: string }[] };
  expect(restored.turns[0].status).toBe("done");
  const slow = await web(cookie, path + "/turns", "POST", { text: "slow", skill: "chat", language: "en", parent: restored.turns[0].id });
  expect((await web(cookie, path + "/stop", "POST")).status).toBe(204);
  expect(await slow.text()).toContain('"status":"cancelled"');
  expect(await (await web(cookie, "/api/conversations?search=train")).json()).toMatchObject([{ id: conv.id }]);
  expect((await web(cookie, "/api/logout", "POST")).status).toBe(204);
  expect((await web(cookie, path)).status).toBe(401);
});
