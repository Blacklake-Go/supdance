import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { version } from "../package.json";

const publicHttps = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash && !url.search &&
    url.hostname.includes(".") && !/^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname) &&
    !url.hostname.endsWith(".example") && !url.hostname.endsWith(".test");
});
const submission = process.argv.includes("--submission");
const remote = process.env.SUPDANCE_PLUGIN_PACKAGE_MCP_URL;
const providedClient = process.env.SUPDANCE_PLUGIN_PACKAGE_OAUTH_CLIENT_ID;
const client = providedClient
  ? { mode: "provided", clientId: z.string().trim().min(1).max(256).parse(providedClient),
      tokenEndpointAuthMethod: z.enum(["none", "client_secret_basic", "client_secret_post"])
        .parse(process.env.SUPDANCE_PLUGIN_PACKAGE_OAUTH_CLIENT_AUTH || "client_secret_basic") }
  : { mode: "dcr" };
const manifest = await Bun.file("plugin/plugin.json").json();
if (manifest.name !== "supdance" || manifest.version !== version) throw new Error("Manifest identity/version mismatch");
const fields = manifest.extensions["com.openai"];
if (remote) publicHttps.parse(remote);
if (submission) {
  publicHttps.parse(remote);
  fields.interface.developerName = z.string().trim().min(1).max(80).parse(process.env.SUPDANCE_PLUGIN_PUBLISHER);
  for (const [field, name] of [
    ["privacyPolicyURL", "PRIVACY_URL"], ["termsOfServiceURL", "TERMS_URL"], ["supportURL", "SUPPORT_URL"],
  ]) fields.interface[field] = publicHttps.parse(process.env["SUPDANCE_PLUGIN_" + name]);
  fields.review.demo_recording_url = publicHttps.parse(process.env.SUPDANCE_PLUGIN_DEMO_URL);
  fields.publication.countries = z.array(z.string().regex(/^[A-Z]{2}$/)).parse(JSON.parse(process.env.SUPDANCE_PLUGIN_COUNTRIES || "null"));
}
const dir = await mkdtemp(join(tmpdir(), "supdance-"));
try {
  await cp("plugin/assets", join(dir, "assets"), { recursive: true });
  await cp("plugin/skills", join(dir, "skills"), { recursive: true });
  await writeFile(join(dir, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (remote) {
    await writeFile(join(dir, "mcp.json"), JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { supdance: { type: "streamable-http", url: remote, extensions: {
        "com.openai": { auth: { type: "oauth", client, baseScopes: ["story:generate", "projects:read", "projects:write", "canvas:read", "canvas:write"] } },
      } } },
    }, null, 2) + "\n");
  }
  await mkdir("release", { recursive: true });
  const out = resolve("release", `supdance-${version}-${submission ? "submission" : "candidate"}.zip`);
  await rm(out, { force: true });
  const entries = ["plugin.json", ...(remote ? ["mcp.json"] : []), "skills", "assets"];
  const zip = Bun.spawnSync(["zip", "-q", "-X", "-r", out, ...entries], { cwd: dir });
  if (zip.exitCode) throw new Error(zip.stderr.toString());
  const check = Bun.spawnSync(["unzip", "-tq", out]);
  if (check.exitCode) throw new Error(check.stderr.toString());
  console.log(out);
  if (!submission) console.log("Candidate only. A public MCP URL and verified release metadata are required for submission.");
} finally { await rm(dir, { recursive: true, force: true }); }
