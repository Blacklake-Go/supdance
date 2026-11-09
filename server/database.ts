import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { strict: true });
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");
  db.run("PRAGMA busy_timeout=5000");
  db.transaction(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS oauth_flows (
        id TEXT PRIMARY KEY, state TEXT NOT NULL, verifier TEXT NOT NULL, target TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS web_sessions (id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, nonce TEXT NOT NULL, payload TEXT NOT NULL,
        quote TEXT NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL, lease TEXT, lease_until INTEGER,
        result TEXT, error TEXT, UNIQUE(owner, nonce)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, project_id TEXT,
        draft TEXT, updated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(owner, updated DESC);
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent TEXT REFERENCES turns(id) ON DELETE CASCADE, input TEXT NOT NULL, output TEXT NOT NULL,
        artifact TEXT, status TEXT NOT NULL, error TEXT, created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS turns_conversation ON turns(conversation, created);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_turn ON turns(conversation) WHERE status = 'running';
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL,
        event TEXT NOT NULL, target TEXT, outcome TEXT NOT NULL
      );
      PRAGMA user_version=1;
    `);
  })();
  // Production runs one process per database. An interrupted model stream is safe to retry by explicit request.
  db.run("UPDATE turns SET status='failed', error='interrupted' WHERE status='running'");
  return db;
}
export type DB = ReturnType<typeof openDatabase>;

export function audit(db: DB, actor: string, event: string, outcome: string, target: string | null = null) {
  db.run("INSERT INTO audit(at,actor,event,target,outcome) VALUES(?,?,?,?,?)", [Date.now(), actor, event, target, outcome]);
}
