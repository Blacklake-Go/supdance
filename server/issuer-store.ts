import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { errors, type Adapter, type AdapterPayload } from "oidc-provider";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const seconds = () => Math.floor(Date.now() / 1000);

export function issuerStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS objects (
      kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER,
      uid TEXT, user_code TEXT, grant_id TEXT, consumed INTEGER, PRIMARY KEY(kind, key)
    );
    CREATE INDEX IF NOT EXISTS oauth_object_uid ON objects(kind, uid);
    CREATE INDEX IF NOT EXISTS oauth_object_user_code ON objects(kind, user_code);
    CREATE INDEX IF NOT EXISTS oauth_object_grant ON objects(grant_id);
    CREATE INDEX IF NOT EXISTS oauth_object_expiry ON objects(expires);
  `);
  const cleanup = db.prepare("DELETE FROM objects WHERE expires <= ?");
  let cleanAfter = 0;

  const adapter = (kind: string): Adapter => {
    type Row = { payload: string; consumed: number | null };
    function find(column: "key" | "uid" | "user_code", value: string) {
      const row = db.prepare(
        `SELECT payload, consumed FROM objects WHERE kind = ? AND ${column} = ? AND (expires IS NULL OR expires > ?)`,
      ).get(kind, digest(value), seconds()) as Row | undefined;
      if (!row) return;
      const payload: AdapterPayload = JSON.parse(row.payload);
      if (row.consumed !== null) payload.consumed = row.consumed;
      return payload;
    }

    return {
      async upsert(id, payload, expiresIn) {
        const now = seconds();
        if (now >= cleanAfter) {
          cleanup.run(now);
          cleanAfter = now + 300;
        }
        db.prepare(`
          INSERT INTO objects(kind,key,payload,expires,uid,user_code,grant_id)
          VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(kind,key) DO UPDATE SET
            payload=excluded.payload, expires=excluded.expires, uid=excluded.uid,
            user_code=excluded.user_code, grant_id=excluded.grant_id
        `).run(kind, digest(id), JSON.stringify(payload), expiresIn === undefined ? null : now + expiresIn,
          payload.uid ? digest(payload.uid) : null, payload.userCode ? digest(payload.userCode) : null,
          payload.grantId ? digest(payload.grantId) : null);
      },
      async find(id) { return find("key", id); },
      async findByUid(uid) { return find("uid", uid); },
      async findByUserCode(code) { return find("user_code", code); },
      async consume(id) {
        const now = seconds();
        const { changes } = db.prepare(
          "UPDATE objects SET consumed = ? WHERE kind = ? AND key = ? AND consumed IS NULL AND expires > ?",
        ).run(now, kind, digest(id), now);
        if (Number(changes) !== 1) throw new errors.InvalidGrant("The authorization grant has already been used or expired");
      },
      async destroy(id) { db.prepare("DELETE FROM objects WHERE kind = ? AND key = ?").run(kind, digest(id)); },
      async revokeByGrantId(id) { db.prepare("DELETE FROM objects WHERE grant_id = ?").run(digest(id)); },
    };
  };
  return { adapter, close: () => db.close() };
}
