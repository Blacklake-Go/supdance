import { actionState, quote, receipt, type Action, type Approval, type Scope } from "../shared/contracts";
import { requireScope, type Identity } from "./auth";
import type { Bridge } from "./bridge";
import type { Config } from "./config";
import { audit, type DB } from "./database";
import { asFailure, Failure } from "./errors";

type Row = {
  id: string; owner: string; payload: string; quote: string; expires: number;
  status: Approval["status"]; result: string | null; error: string | null;
};
const leaseTime = 40000;

export class Actions {
  constructor(private config: Config, private db: DB, private bridge: Bridge) {}

  private authorize(actor: Identity, input: Action) {
    const scope: Scope = input.kind === "project" ? "projects:write"
      : input.kind === "canvas" ? "canvas:write" : "media:generate";
    requireScope(actor, scope);
    if (scope === "media:generate" && !this.config.media) throw new Failure(403, "media_disabled");
  }

  private present(row: Row): Approval {
    return {
      id: row.id, status: actionState.parse(row.status), action: JSON.parse(row.payload),
      quote: quote.parse(JSON.parse(row.quote)), reviewUrl: this.config.webOrigin + this.config.webBase + "/review/" + row.id,
      receipt: row.result ? receipt.parse(JSON.parse(row.result)) : undefined, error: row.error || undefined,
    };
  }

  private row(actor: Identity, id: string) {
    const row = this.db.query<Row, [string, string]>("SELECT * FROM approvals WHERE id=? AND owner=?").get(id, actor.owner);
    if (!row) throw new Failure(404, "not_found");
    this.authorize(actor, JSON.parse(row.payload));
    return row;
  }

  get(actor: Identity, id: string) { return this.present(this.row(actor, id)); }

  async preview(actor: Identity, nonce: string, input: Action) {
    this.authorize(actor, input);
    const payload = JSON.stringify(input);
    const existing = () => this.db.query<Row, [string, string]>("SELECT * FROM approvals WHERE owner=? AND nonce=?").get(actor.owner, nonce);
    const present = (row: Row) => {
      if (row.payload !== payload) throw new Failure(409, "idempotency_conflict");
      return this.present(row);
    };
    const previous = existing();
    if (previous) return present(previous);
    const estimate = await this.bridge.preview(actor, input);
    if (estimate.expiresAt <= Date.now() || (estimate.credits !== 0 && input.kind !== "image" && input.kind !== "video" && input.kind !== "music")) {
      throw new Failure(502, "partner_response_invalid");
    }
    return this.db.transaction(() => {
      const row = existing();
      if (row) return present(row);
      const id = crypto.randomUUID();
      const expires = Math.min(estimate.expiresAt, Date.now() + 15 * 60_000);
      this.db.run("INSERT INTO approvals(id,owner,nonce,payload,quote,expires,status) VALUES(?,?,?,?,?,?,'pending')",
        [id, actor.owner, nonce, payload, JSON.stringify({ ...estimate, expiresAt: expires }), expires]);
      audit(this.db, actor.owner, "approval.preview", "pending", id);
      return this.get(actor, id);
    })();
  }

  decide(actor: Identity, id: string, approve: boolean) {
    return this.db.transaction(() => {
      const current = this.row(actor, id);
      if (current.status !== "pending" || current.expires <= Date.now()) throw new Failure(409, "approval_unavailable");
      const next = approve ? "approved" : "rejected";
      this.db.run("UPDATE approvals SET status=? WHERE id=?", [next, id]);
      audit(this.db, actor.owner, "approval.decide", next, id);
      return this.get(actor, id);
    })();
  }

  async execute(actor: Identity, id: string, expectedKind?: Action["kind"]) {
    const lease = crypto.randomUUID();
    const claim = this.db.transaction(() => {
      const current = this.row(actor, id);
      if (expectedKind && JSON.parse(current.payload).kind !== expectedKind) throw new Failure(409, "wrong_action");
      if (current.status === "done" || current.status === "failed") return { current, claimed: false };
      if (current.status !== "approved" && current.status !== "running") throw new Failure(409, "approval_required");
      const now = Date.now();
      if (current.status === "approved" && current.expires <= now) throw new Failure(409, "approval_expired");
      const result = this.db.run(`UPDATE approvals SET status='running',lease=?,lease_until=?
        WHERE id=? AND (status='approved' OR lease_until <= ?)`, [lease, now + leaseTime, id, now]);
      if (result.changes) audit(this.db, actor.owner, "action.commit", "running", id);
      return { current: this.row(actor, id), claimed: result.changes > 0 };
    })();
    if (!claim.claimed) return this.present(claim.current);
    const current = this.present(claim.current);
    let result: Awaited<ReturnType<Bridge["execute"]>>;
    try {
      result = await this.bridge.execute(actor, current.action, current.quote.id, current.quote.credits, id);
    } catch (error) {
      const failure = asFailure(error);
      this.db.transaction(() => {
        if (this.db.run("UPDATE approvals SET status=?,error=?,lease_until=? WHERE id=? AND lease=?",
          [failure.retryable ? "running" : "failed", failure.code, Date.now() + 3000, id, lease]).changes) {
          audit(this.db, actor.owner, "action.commit", failure.code, id);
        }
      })();
      return this.get(actor, id);
    }
    this.db.transaction(() => {
      if (this.db.run("UPDATE approvals SET status='done',result=?,error=NULL WHERE id=? AND lease=?",
        [JSON.stringify(result), id, lease]).changes) audit(this.db, actor.owner, "action.commit", "done", id);
    })();
    return this.get(actor, id);
  }
}
