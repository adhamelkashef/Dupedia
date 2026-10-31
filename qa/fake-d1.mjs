/* A small stand-in for Cloudflare D1 on Node's built-in SQLite (node:sqlite, Node 22.5+), for the research tests only.
   Same calls the Worker uses: prepare().bind().first() / .all() / .run(), and batch([...]). */
import { DatabaseSync } from "node:sqlite";

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE docs (path TEXT PRIMARY KEY, parent TEXT NOT NULL, data TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 1, at TEXT NOT NULL);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL); CREATE TABLE leases (path TEXT PRIMARY KEY, holder TEXT NOT NULL, exp INTEGER NOT NULL);
    CREATE TABLE users (uid TEXT PRIMARY KEY, owner INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);`);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; }, raw: db };
}
