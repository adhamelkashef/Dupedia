/* X FORCE Market Intelligence 2.0: how much processing one research ingest takes as saved opportunities grow, with the switch off and on.
   Workers Free allows 10 ms of CPU per run, so this shows where that becomes a problem. A laptop is not Cloudflare: read the
   trend and compare it with the real CPU time in Cloudflare's logs. Made-up records only.
   Run:  node qa/mi_cpu.bench.mjs */
import { ingest } from "../worker/intel.js";

const T = Date.parse("2026-11-07T10:00:00Z");
const words = "compound school resort club playground park beach garden tower phase villa lagoon marina hills gate".split(" ");
const pick = (i, n) => words[(i * 7 + n * 3) % words.length];
const cand = (i) => ({ title: `${pick(i, 1)} ${pick(i, 2)} ${pick(i, 3)} ${i}`, organization: `Org ${pick(i, 4)} ${i}`, location: "New Cairo, Egypt", category: "compound", kind: "project", description: "A new development with a kids area, clubhouse and landscaped parks. ".repeat(4), products: ["Outdoor playground"], sourceUrl: `https://example.com/p/${i}`, sourceType: "media", publishedAt: "2026-11-01" });
function savedDb(n) {
  const db = {}, r = ingest("opportunities", {}, Array.from({ length: n }, (_, i) => cand(i)), T), json = JSON.stringify(Object.fromEntries(r.writes.filter((w) => w.collection === "mi/opps/o").map((w) => [w.doc_id, w.data])));
  return { json, build: () => { db["mi/opps/o"] = JSON.parse(json); return db; } };
}
const fresh = Array.from({ length: 10 }, (_, i) => cand(100000 + i));
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
console.log("saved | size KB | parse ms | ingest off ms | ingest on ms | total on ms");
for (const n of [50, 200, 400, 1000, 2000]) {
  const s = savedDb(n), parse = [], off = [], on = [];
  for (let i = 0; i < 9; i++) {
    let t = performance.now(); const db = s.build(); parse.push(performance.now() - t);
    t = performance.now(); ingest("opportunities", db, fresh, T); off.push(performance.now() - t);
    t = performance.now(); ingest("opportunities", db, fresh, T, { engine: true }); on.push(performance.now() - t);
  }
  const [p, f, o] = [median(parse), median(off), median(on)];
  console.log([n, Math.round(s.json.length / 1024), p.toFixed(2), f.toFixed(2), o.toFixed(2), (p + o).toFixed(2)].join(" | "));
}
