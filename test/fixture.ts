import { createHash } from "node:crypto";
import { scopes } from "../shared/contracts";
import { configuration } from "../server/config";
import { application } from "../server/index";

export const sampleShot = {
  number: 1, scene: "Train", framing: "Close up", camera: "Eye level", movement: "Static",
  durationSeconds: 3, action: "Courier reads the label", setting: "Station at dusk", dialogue: "",
  sound: "Rail squeal", lighting: "Blue hour", imagePrompt: "Courier at station", videoPrompt: "Close up on the label",
};

export async function fixture(media = false, built = false, webBase = "") {
  const state = { revision: "r1", commitCount: 0, revoked: false, failAfterCommit: false };
  const receipts = new Map<string, unknown>();
  const quotes = new Map<string, { subject: string; body: unknown; credits: number }>();
  let origin = "", issuer = "", challenge = "";
  const provider = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === "/authorize") {
        challenge = url.searchParams.get("code_challenge") ?? "";
        const redirect = new URL(url.searchParams.get("redirect_uri")!);
        if (redirect.origin !== origin || redirect.pathname !== webBase + "/oauth/callback" || url.searchParams.get("resource") !== origin + "/mcp" || url.searchParams.get("code_challenge_method") !== "S256") return new Response(null, { status: 400 });
        redirect.search = new URLSearchParams({ state: url.searchParams.get("state")!, code: "fixture-code", iss: issuer }).toString();
        return Response.redirect(redirect.href);
      }
      if (path === "/token") {
        const params = new URLSearchParams(await req.text());
        if (params.get("code") !== "fixture-code" || createHash("sha256").update(params.get("code_verifier") || "").digest("base64url") !== challenge) return new Response(null, { status: 400 });
        return Response.json({ access_token: "alice-web", token_type: "Bearer" });
      }
      if (path === "/introspect") {
        const token = new URLSearchParams(await req.text()).get("token") || "";
        if (!["alice-web", "alice-mcp", "bob-mcp", "narrow-mcp", "wrong-aud", "expired-mcp"].includes(token) || state.revoked) return Response.json({ active: false });
        return Response.json({ active: true, token_type: "Bearer", iss: issuer, sub: token.startsWith("bob") ? "bob" : "alice",
          aud: token === "wrong-aud" ? "https://other.example" : origin + "/mcp", exp: Math.floor(Date.now() / 1000) + (token === "expired-mcp" ? -60 : 3600),
          client_id: token.endsWith("-web") ? "web-client" : "mcp-client", scope: token === "narrow-mcp" ? "projects:read" : scopes.join(" ") });
      }
      if (req.headers.get("authorization") !== "Bearer fixture-bridge") return new Response(null, { status: 403 });
      const subject = Buffer.from(req.headers.get("x-supdance-subject") || "", "base64url").toString();
      const project = { id: "train", title: "Last train", summary: "A courier reads a strange label" };
      if (path === "/v1/projects") return Response.json(subject === "alice" ? [project] : []);
      if (path.startsWith("/v1/projects/train") && subject !== "alice") return new Response(null, { status: 404 });
      if (path === "/v1/projects/train") return Response.json(project);
      if (path === "/v1/projects/train/canvases") return Response.json([{ id: "board", projectId: "train", title: "Last train storyboard" }]);
      if (path === "/v1/projects/train/canvases/board") return Response.json({ id: "board", projectId: "train", revision: state.revision, nodes: [] });
      if (path === "/v1/projects/train/tasks/task-1") return Response.json({ id: "task-1", projectId: "train", kind: "image", status: "succeeded", assetIds: ["asset-1"] });
      if (path.startsWith("/v1/media/models/")) return Response.json([{ id: "demo-media", name: "Fixture media model" }]);
      if (path === "/v1/text/models") return Response.json([{ id: "demo-text", name: "Fixture model" }]);
      if (path === "/v1/text/stream") {
        const input = await req.json() as { skill: string; maxCredits: number; brief: string };
        if (input.maxCredits !== 0) return new Response(null, { status: 402 });
        if (input.skill === "storyboard") return new Response(JSON.stringify({ title: "Last Train", shots: [sampleShot] }), { headers: { "content-type": "text/plain" } });
        if (input.skill === "outline") return new Response(JSON.stringify({ title: "Last Train", logline: "A courier finds tomorrow's address", world: "A city after dark",
          episodes: [{ title: "The parcel", conflict: "Delivery after closing", beats: ["Find the parcel"], cliffhanger: "The name is hers" }], continuity: ["Night"] }), { headers: { "content-type": "text/plain" } });
        return new Response(new ReadableStream({
          async start(out) {
            const encoder = new TextEncoder();
            out.enqueue(encoder.encode("A station after midnight. "));
            await Bun.sleep(input.brief === "slow" ? 3000 : 30);
            try { out.enqueue(encoder.encode("The final train is early.")); out.close(); } catch { /* test client cancelled */ }
          },
        }), { headers: { "content-type": "text/plain" } });
      }
      if (path === "/v1/actions/preview") {
        const { action } = await req.json() as { action: { kind: string; revision?: string; projectId?: string } };
        if (action.projectId && subject !== "alice") return new Response(null, { status: 404 });
        if (action.kind === "canvas" && action.revision !== state.revision) return new Response(null, { status: 409 });
        const id = crypto.randomUUID(), credits = action.kind === "image" ? 3 : 0;
        quotes.set(id, { subject, body: action, credits });
        return Response.json({ id, credits, expiresAt: Date.now() + 60000 });
      }
      if (path === "/v1/actions/commit") {
        const key = req.headers.get("idempotency-key")!;
        const { action, quoteId, maxCredits } = await req.json() as { action: { kind: string; revision?: string }; quoteId: string; maxCredits: number };
        const quote = quotes.get(quoteId);
        if (!quote || quote.subject !== subject || quote.credits !== maxCredits || JSON.stringify(quote.body) !== JSON.stringify(action)) return new Response(null, { status: 403 });
        if (receipts.has(key)) return Response.json(receipts.get(key));
        if (action.kind === "canvas" && action.revision !== state.revision) return new Response(null, { status: 409 });
        state.commitCount++;
        let result;
        if (action.kind === "canvas") {
          state.revision = "r" + (state.commitCount + 1);
          result = { kind: "canvas", canvasId: "board", nodeIds: ["shot-1"], revision: state.revision };
        } else if (action.kind === "image") {
          result = { kind: "image", task: { id: "task-1", projectId: "train", kind: "image", status: "queued", assetIds: [] } };
        } else result = { kind: "project", project };
        receipts.set(key, result);
        if (state.failAfterCommit) { state.failAfterCommit = false; return new Response(null, { status: 503 }); }
        return Response.json(result);
      }
      return new Response(null, { status: 404 });
    },
  });
  issuer = provider.url.origin;
  let dispatch: ReturnType<typeof application>["fetch"];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => dispatch(req) });
  origin = server.url.origin;
  const config = configuration({
    SUPDANCE_PLUGIN_DEV: "1", SUPDANCE_PLUGIN_ORIGIN: origin, SUPDANCE_PLUGIN_WEB_BASE: webBase, SUPDANCE_PLUGIN_DATABASE: ":memory:",
    SUPDANCE_PLUGIN_OAUTH_ISSUER: issuer, SUPDANCE_PLUGIN_OAUTH_AUTHORIZATION: issuer + "/authorize",
    SUPDANCE_PLUGIN_OAUTH_TOKEN: issuer + "/token", SUPDANCE_PLUGIN_OAUTH_INTROSPECTION: issuer + "/introspect",
    SUPDANCE_PLUGIN_INTROSPECTION_ID: "rs", SUPDANCE_PLUGIN_INTROSPECTION_SECRET: "fixture-secret",
    SUPDANCE_PLUGIN_WEB_CLIENT_ID: "web-client", SUPDANCE_PLUGIN_WEB_CLIENT_SECRET: "fixture-client-secret",
    SUPDANCE_PLUGIN_SESSION_KEY: "f0".repeat(32), SUPDANCE_PLUGIN_BRIDGE_URL: issuer, SUPDANCE_PLUGIN_BRIDGE_SECRET: "fixture-bridge",
    SUPDANCE_PLUGIN_MEDIA_ENABLED: media ? "1" : "0",
    SUPDANCE_PLUGIN_PROJECTS_WRITE_ENABLED: "1",
  });
  const app = application(config, {
    index: await Bun.file(built ? "dist/index.html" : "web/index.html").text(),
    app: built ? await Bun.file("dist/app.js").text() : "", css: built ? await Bun.file("dist/styles.css").text() : "",
    widget: built ? await Bun.file("dist/widget.html").text() : "<main>Supdance</main>",
    icon: built ? await Bun.file("plugin/assets/icon.png").bytes() : new Uint8Array(),
  });
  dispatch = app.fetch;
  return { origin, webBase, app, state, stop() { server.stop(true); provider.stop(true); app.db.close(); } };
}
