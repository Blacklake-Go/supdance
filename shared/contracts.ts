import { z } from "zod";

export const ID = z.string().regex(/^[\w-]{1,128}$/).describe("Opaque Supdance identifier");
export const text = (max: number) => z.string().trim().min(1).max(max);
export const language = z.enum(["zh-CN", "en"]);
export const skill = z.enum(["chat", "plan", "outline", "character", "script", "dialogue", "storyboard"]);
export const scopes = ["story:generate", "projects:read", "projects:write", "canvas:read", "canvas:write", "media:read", "media:generate"] as const;
export type Scope = typeof scopes[number];

const field = text(2000);
const list = z.array(field).min(1).max(24);
export const shot = z.strictObject({
  number: z.number().int().positive().max(120),
  scene: field, framing: field, camera: field, movement: field,
  durationSeconds: z.number().positive().max(120),
  action: field, setting: field, dialogue: z.string().max(2000),
  sound: field, lighting: field, imagePrompt: field, videoPrompt: field,
});

export const shots = z.array(shot).min(1).max(24)
  .refine((items) => new Set(items.map((item) => item.number)).size === items.length, "Shot numbers must be unique");

export const storySchemas = {
  plan: z.strictObject({ goal: field, assumptions: z.array(field).max(12),
    steps: z.array(z.strictObject({ skill: skill.exclude(["plan", "chat"]), reason: field })).min(1).max(12) }),
  outline: z.strictObject({ title: field, logline: field, world: field,
    episodes: z.array(z.strictObject({ title: field, conflict: field, beats: list, cliffhanger: field })).min(1).max(16),
    continuity: list }),
  character: z.strictObject({ name: field, appearance: field, personality: field, motivation: field,
    relationships: list, arc: field, visualConsistency: field, dialogueStyle: field }),
  script: z.strictObject({ title: field, episode: z.number().int().min(1).max(120),
    scenes: z.array(z.strictObject({ heading: field, action: field, dialogue: list, hook: field })).min(1).max(16),
    continuity: list }),
  dialogue: z.strictObject({ dialogue: list, choices: list }),
  storyboard: z.strictObject({ title: field, shots }),
};
export type StorySkill = keyof typeof storySchemas;
export const storyInput = z.strictObject({
  brief: text(16000).describe("User's creative brief and constraints"),
  context: text(32000).optional().describe("User-selected source text for continuity and revision"),
  language: language.default("zh-CN"),
  model: ID.optional(),
});

export const project = z.strictObject({ id: ID, title: text(240), summary: z.string().max(2000) });
export const canvasSummary = z.strictObject({ id: ID, projectId: ID, title: text(240) });
export const canvas = z.strictObject({
  id: ID, projectId: ID, revision: text(256),
  nodes: z.array(z.strictObject({ id: ID, type: ID, label: text(240) })).max(100),
});
export const mediaKind = z.enum(["image", "video", "music"]);
export const task = z.strictObject({
  id: ID, projectId: ID, kind: mediaKind,
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  progress: z.number().min(0).max(100).optional(),
  assetIds: z.array(ID).max(24).default([]),
  errorCode: ID.optional(),
});
export const modelList = z.array(z.strictObject({ id: ID, name: text(160) })).max(100);
export const projectWrite = z.strictObject({ kind: z.literal("project"), title: text(240), summary: text(2000) });
export const canvasWrite = z.strictObject({ kind: z.literal("canvas"), projectId: ID, canvasId: ID,
  revision: text(256), shots });
export const mediaWrite = z.strictObject({
  kind: mediaKind, projectId: ID, model: ID, prompt: text(12000), shotNumber: z.number().int().positive().optional(),
});
export const action = z.discriminatedUnion("kind", [projectWrite, canvasWrite, mediaWrite]);
export type Action = z.infer<typeof action>;
export const quote = z.strictObject({
  id: ID, credits: z.number().int().nonnegative().max(1_000_000_000),
  expiresAt: z.number().int().positive(),
});
export const receipt = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), project }),
  z.strictObject({ kind: z.literal("canvas"), canvasId: ID, revision: text(256), nodeIds: z.array(ID).min(1).max(24) }),
  z.strictObject({ kind: mediaKind, task }),
]);
export const actionState = z.enum(["pending", "approved", "running", "done", "rejected", "failed"]);
export const approval = z.strictObject({
  id: ID, status: actionState, action, quote, reviewUrl: z.url(), receipt: receipt.optional(),
  error: ID.optional(),
});
export type Approval = z.infer<typeof approval>;

export const attachment = z.strictObject({ name: text(160), text: text(32000) });
export const draft = z.strictObject({
  text: z.string().max(16000), skill, model: ID.optional(), attachment: attachment.optional(),
});
export const turnInput = draft.extend({ text: text(16000), language, parent: ID.optional() });
export type Draft = z.infer<typeof draft>;
export type TurnInput = z.infer<typeof turnInput>;
