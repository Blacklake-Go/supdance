import { z } from "zod";
import { action, canvas, ID, modelList, project, quote, receipt, task, text, type Action, type StorySkill, storySchemas } from "../shared/contracts";
import type { Identity } from "./auth";
import type { Config } from "./config";
import { Failure } from "./errors";
import { storyInstructions } from "./story";

const knownErrors = new Map([
  [400, "partner_invalid_input"], [401, "partner_unauthorized"], [402, "entitlement_required"],
  [403, "partner_forbidden"], [404, "not_found"], [409, "stale_revision_or_quote"],
  [422, "partner_rejected"], [429, "rate_limited"],
]);

export class Bridge {
  constructor(private config: Config) {}

  private async fetch(actor: Identity, route: string, body?: unknown, signal?: AbortSignal, key?: string) {
    if (!this.config.bridge) throw new Failure(503, "partner_unconfigured");
    const { url, secret } = this.config.bridge;
    try {
      const response = await fetch(url + "/v1" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: "Bearer " + secret, "content-type": "application/json",
          "x-supdance-subject": Buffer.from(actor.subject).toString("base64url"),
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: signal ? AbortSignal.any([AbortSignal.timeout(90000), signal]) : AbortSignal.timeout(18000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Failure(knownErrors.has(response.status) ? response.status : 502,
          knownErrors.get(response.status) || "partner_unavailable", response.status >= 500 || response.status === 429);
      }
      return response;
    } catch (error) {
      if (signal?.aborted) throw new Failure(409, "cancelled");
      if (error instanceof Failure) throw error;
      throw new Failure(502, "partner_unavailable", true);
    }
  }

  private async json<T>(actor: Identity, route: string, schema: z.ZodType<T>, body?: unknown, key?: string): Promise<T> {
    const response = await this.fetch(actor, route, body, undefined, key);
    try {
      return schema.parse(await boundedText(response).then(JSON.parse));
    } catch {
      throw new Failure(502, "partner_response_invalid", true);
    }
  }

  projects(actor: Identity) { return this.json(actor, "/projects", z.array(project).max(100)); }
  project(actor: Identity, id: string) { return this.json(actor, "/projects/" + ID.parse(id), project); }
  canvas(actor: Identity, projectId: string, id: string) {
    return this.json(actor, "/projects/" + ID.parse(projectId) + "/canvases/" + ID.parse(id), canvas);
  }
  task(actor: Identity, projectId: string, id: string) {
    return this.json(actor, "/projects/" + ID.parse(projectId) + "/tasks/" + ID.parse(id), task);
  }
  models(actor: Identity) { return this.json(actor, "/text/models", modelList); }
  preview(actor: Identity, input: Action) {
    return this.json(actor, "/actions/preview", quote, { action: input });
  }
  async execute(actor: Identity, input: Action, quoteId: string, maxCredits: number, key: string) {
    const result = await this.json(actor, "/actions/commit", receipt, {
      action: action.parse(input), quoteId, maxCredits,
    }, key);
    if (result.kind !== input.kind ||
        (result.kind === "canvas" && (input.kind !== "canvas" || result.canvasId !== input.canvasId)) ||
        ("task" in result && (!("projectId" in input) || result.task.projectId !== input.projectId || result.task.kind !== result.kind))) {
      throw new Failure(502, "partner_response_invalid", true);
    }
    return result;
  }

  async generate(actor: Identity, input: {
    skill: StorySkill | "chat"; language: "zh-CN" | "en"; model?: string; brief: string;
    context?: string; projectId?: string;
  }, signal: AbortSignal, onText: (chunk: string) => void) {
    const schema = input.skill === "chat" ? undefined : storySchemas[input.skill];
    const response = await this.fetch(actor, "/text/stream", {
      ...input, instructions: storyInstructions(input.skill, input.language), schema: schema ? z.toJSONSchema(schema) : undefined,
      // This endpoint admits only entitlement-included text requests.
      maxCredits: 0,
    }, signal);
    if (!response.headers.get("content-type")?.startsWith("text/plain")) {
      await response.body?.cancel();
      throw new Failure(502, "partner_response_invalid", true);
    }
    const output = await boundedText(response, (chunk) => { if (!schema) onText(chunk); }, 96000);
    if (!schema) return { output: text(96000).parse(output), artifact: null };
    try {
      const artifact = schema.parse(JSON.parse(output));
      return { output: JSON.stringify(artifact), artifact };
    } catch {
      throw new Failure(502, "structured_output_invalid", true);
    }
  }
}

async function boundedText(response: Response, onText?: (chunk: string) => void, max = 512000) {
  if (!response.body) throw new Failure(502, "partner_response_invalid");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let output = "", size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Failure(502, "partner_response_too_large");
      const chunk = decoder.decode(value, { stream: true });
      output += chunk;
      if (chunk) onText?.(chunk);
    }
    const rest = decoder.decode();
    if (rest) onText?.(rest);
    return output + rest;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
