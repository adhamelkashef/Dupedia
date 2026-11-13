/* Local Worker smoke runner: `npm run test:smoke`.
   Each group gets its own fresh `wrangler dev --local` server and temp database; the files in a group run in order
   against that server (growth-operations and growth-medium-routes reuse the accounts growth-routes creates).
   qa/research_routes.smoke.mjs is NOT here: it calls Tavily's live keyless search over the network.
   Exits 1 if any group fails. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const GROUPS = [
  { name: 'growth', code: 'local-growth-fixture-only', files: ['qa/growth-routes.smoke.mjs', 'qa/growth-operations.smoke.mjs', 'qa/growth-medium-routes.smoke.mjs'] },
  { name: 'security phase 1', code: 'local-security-fixture-only', files: ['qa/security_phase1.smoke.mjs'] },
  { name: 'no setup code', code: null, check: noCodeCheck },
];

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const servers = new Set();
const killServer = child => { try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL'); } catch {} servers.delete(child); };
const killAll = () => { for (const c of [...servers]) killServer(c); };
process.on('exit', killAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killAll(); process.exit(130); });

async function startServer(code, persist) {
  const port = await freePort();
  const args = [WRANGLER, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist];
  if (code) args.push('--var', 'SETUP_CODE:' + code);
  const child = spawn(process.execPath, args, { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
  servers.add(child);
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const base = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try { const r = await fetch(base + '/login', { redirect: 'manual' }); if (r.status === 200) return { child, base }; } catch {}
    await sleep(500);
  }
  killServer(child);
  throw new Error('server did not answer GET /login with 200 within 60 s\n' + log.split('\n').slice(-20).join('\n'));
}

/* /api/recover must say "nocode" (503) when the Worker has no SETUP_CODE secret */
async function noCodeCheck(base) {
  const r = await fetch(base + '/api/recover', { method: 'POST', headers: { 'content-type': 'application/json', 'x-xf': '1' }, body: '{}' });
  const j = await r.json().catch(() => null);
  if (r.status !== 503 || !j || j.error !== 'nocode') throw new Error('expected 503 {error:"nocode"}, got ' + r.status + ' ' + JSON.stringify(j));
  console.log('PASS /api/recover answers 503 nocode without SETUP_CODE');
}

let failed = 0;
for (const g of GROUPS) {
  const persist = mkdtempSync(path.join(os.tmpdir(), 'xf-smoke-'));
  let srv;
  try {
    srv = await startServer(g.code, persist);
    for (const f of g.files || []) {
      const r = spawnSync(process.execPath, [path.join(root, f), srv.base], { cwd: root, stdio: 'inherit', timeout: 300000 });
      if (r.status !== 0) throw new Error(f + ' failed (' + (r.error ? r.error.code : 'exit ' + r.status) + ')');
      console.log('PASS ' + f);
    }
    if (g.check) await g.check(srv.base);
    console.log('PASS group: ' + g.name);
  } catch (e) {
    failed++;
    console.log('FAIL group: ' + g.name + '\n' + String(e.message || e).replace(/^/gm, '    '));
  } finally {
    if (srv) killServer(srv.child);
    await sleep(300);
    rmSync(persist, { recursive: true, force: true });
  }
}
console.log(failed ? `\n${failed} of ${GROUPS.length} smoke groups FAILED` : `\nAll ${GROUPS.length} smoke groups passed`);
process.exit(failed ? 1 : 0);
