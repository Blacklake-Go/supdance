import type { Bridge } from "./bridge";
import type { DB } from "./database";
import { audit } from "./database";
import type { Identity } from "./auth";
import { requireScope } from "./auth";
import { asFailure, Failure } from "./errors";
import { storySchemas, type Draft, type TurnInput } from "../shared/contracts";

type Conversation = { id: string; title: string; project_id: string | null; draft: string | null; updated: number };
type Turn = { id: string; parent: string | null; input: string; output: string; artifact: string | null;
  status: string; error: string | null; created: number };
function present(row: Turn) {
  const { editedFrom, ...input } = JSON.parse(row.input) as TurnInput & { editedFrom?: string };
  return { ...row, input, editedFrom, artifact: row.artifact ? JSON.parse(row.artifact) : null };
}
const line = (data: unknown) => JSON.stringify(data) + "\n";

export class Conversations {
  private running = new Map<string, AbortController>();

  constructor(private db: DB, private bridge: Bridge) {}

  list(actor: Identity, search: string) {
    return this.db.query<Omit<Conversation, "draft">, [string, string]>(
      "SELECT id,title,project_id,updated FROM conversations WHERE owner=? AND instr(lower(title),lower(?))>0 ORDER BY updated DESC LIMIT 100",
    ).all(actor.owner, search);
  }

  private owned(actor: Identity, id: string) {
    const row = this.db.query<Conversation, [string, string]>("SELECT id,title,project_id,draft,updated FROM conversations WHERE id=? AND owner=?").get(id, actor.owner);
    if (!row) throw new Failure(404, "not_found");
    return row;
  }

  detail(actor: Identity, id: string) {
    const row = this.owned(actor, id);
    const turns = this.db.query<Turn, [string]>("SELECT * FROM turns WHERE conversation=? ORDER BY created,rowid LIMIT 200").all(id);
    return { ...row, draft: row.draft ? JSON.parse(row.draft) as Draft : null, turns: turns.map(present) };
  }

  async create(actor: Identity, title: string, projectId?: string) {
    requireScope(actor, "story:generate");
    if (projectId) {
      requireScope(actor, "projects:read");
      await this.bridge.project(actor, projectId);
    }
    const id = crypto.randomUUID();
    this.db.run("INSERT INTO conversations(id,owner,title,project_id,updated) VALUES(?,?,?,?,?)",
      [id, actor.owner, title, projectId ?? null, Date.now()]);
    return this.detail(actor, id);
  }

  remove(actor: Identity, id: string) {
    this.owned(actor, id);
    if (this.running.has(id)) throw new Failure(409, "generation_running");
    this.db.run("DELETE FROM conversations WHERE id=? AND owner=?", [id, actor.owner]);
  }

  save(actor: Identity, id: string, draft: Draft) {
    this.owned(actor, id);
    this.db.run("UPDATE conversations SET draft=? WHERE id=? AND owner=?", [JSON.stringify(draft), id, actor.owner]);
  }

  stop(actor: Identity, id: string) {
    this.owned(actor, id);
    this.running.get(id)?.abort();
  }

  async setProject(actor: Identity, id: string, projectId: string | null) {
    this.owned(actor, id);
    if (projectId) {
      requireScope(actor, "projects:read");
      await this.bridge.project(actor, projectId);
    }
    this.db.run("UPDATE conversations SET project_id=? WHERE id=? AND owner=?", [projectId, id, actor.owner]);
    return this.detail(actor, id);
  }

  revise(actor: Identity, id: string, originalId: string, value: unknown) {
    requireScope(actor, "story:generate");
    this.owned(actor, id);
    return this.db.transaction(() => {
      if (this.running.has(id)) throw new Failure(409, "generation_running");
      const original = this.db.query<Turn, [string, string]>("SELECT * FROM turns WHERE id=? AND conversation=? AND status='done'").get(originalId, id);
      if (!original) throw new Failure(404, "not_found");
      const { input, artifact } = present(original);
      if (input.skill === "chat" || !artifact) throw new Failure(409, "artifact_required");
      const count = this.db.query<{ total: number }, [string]>("SELECT count(*) AS total FROM turns WHERE conversation=?").get(id);
      if ((count?.total ?? 0) >= 200) throw new Failure(409, "conversation_limit");
      const edited = storySchemas[input.skill].parse(value);
      const output = JSON.stringify(edited);
      const revisedId = crypto.randomUUID();
      this.db.run("INSERT INTO turns VALUES(?,?,?,?,?,?,'done',NULL,?)",
        [revisedId, id, original.parent, JSON.stringify({ ...input, editedFrom: original.id }), output, output, Date.now()]);
      this.db.run("UPDATE conversations SET updated=? WHERE id=?", [Date.now(), id]);
      audit(this.db, actor.owner, "story.revise", "done", revisedId);
      return this.detail(actor, id);
    })();
  }

  stream(actor: Identity, id: string, input: TurnInput) {
    requireScope(actor, "story:generate");
    const conv = this.owned(actor, id);
    if (conv.project_id) requireScope(actor, "projects:read");
    if (this.running.has(id)) throw new Failure(409, "generation_running");
    const { context, turnId } = this.db.transaction(() => {
      const prior = this.db.query<Turn, [string]>("SELECT * FROM turns WHERE conversation=? ORDER BY created,rowid").all(id);
      if (prior.length >= 200) throw new Failure(409, "conversation_limit");
      if (input.parent && !prior.some((turn) => turn.id === input.parent && turn.status === "done")) {
        throw new Failure(404, "not_found");
      }
      const history: Turn[] = [];
      let parent = input.parent;
      while (parent && history.length < 12) {
        const row = prior.find((turn) => turn.id === parent);
        if (!row) break;
        history.unshift(row);
        parent = row.parent ?? undefined;
      }
      const turnId = crypto.randomUUID();
      this.db.run("INSERT INTO turns VALUES(?,?,?,?,'',NULL,'running',NULL,?)",
        [turnId, id, input.parent ?? null, JSON.stringify(input), Date.now()]);
      this.db.run("UPDATE conversations SET draft=NULL,updated=? WHERE id=?", [Date.now(), id]);
      audit(this.db, actor.owner, "story." + input.skill, "running", turnId);
      const sources = history.map((turn) => {
        const previous = present(turn);
        return { brief: previous.input.text, attachment: previous.input.attachment, result: previous.output };
      });
      return { context: JSON.stringify({ prior: JSON.stringify(sources).slice(-32000), attachment: input.attachment }), turnId };
    })();
    const controller = new AbortController();
    this.running.set(id, controller);
    let disconnected = false;
    return new ReadableStream<Uint8Array>({
      start: (stream) => {
        const encoder = new TextEncoder();
        const emit = (data: unknown) => { if (!disconnected) stream.enqueue(encoder.encode(line(data))); };
        emit({ type: "started", id: turnId });
        void (async () => {
          let output = "", artifact: unknown = null, errorCode: string | null = null, status = "done";
          try {
            const result = await this.bridge.generate(actor, {
              skill: input.skill, language: input.language, model: input.model,
              brief: input.text, context, projectId: conv.project_id ?? undefined,
            }, controller.signal, (chunk) => { output += chunk; emit({ type: "delta", text: chunk }); });
            if (controller.signal.aborted) throw new Failure(409, "cancelled");
            ({ output, artifact } = result);
          } catch (error) {
            const failure = controller.signal.aborted ? new Failure(409, "cancelled") : asFailure(error);
            errorCode = failure.code;
            status = failure.code === "cancelled" ? "cancelled" : "failed";
          }
          try {
            this.db.transaction(() => {
              this.db.run("UPDATE turns SET output=?,artifact=?,status=?,error=? WHERE id=?",
                [output, artifact ? JSON.stringify(artifact) : null, status, errorCode, turnId]);
              audit(this.db, actor.owner, "story." + input.skill, errorCode ?? status, turnId);
            })();
            emit({ type: "finished", status, error: errorCode });
          } catch (error) {
            emit({ type: "finished", status: "failed", error: asFailure(error).code });
          } finally {
            this.running.delete(id);
            if (!disconnected) stream.close();
          }
        })();
      },
      // Detach the viewer. The same run continues and is recoverable from history.
      cancel: () => { disconnected = true; },
    });
  }
}
