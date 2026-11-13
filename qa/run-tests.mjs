/* Unit test runner: `npm test`. No network, no server. Exits 1 if any file fails.
   Runs every qa/*.test.mjs and qa/*.test.cjs with node, then the Site Planner suite (60 s limit per file, 300 s for the planner). */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'qa');
const files = readdirSync(dir).filter(f => /\.test\.(mjs|cjs)$/.test(f)).sort().map(f => ({ label: 'qa/' + f, cmd: process.execPath, args: [path.join(dir, f)] }));
files.push({ label: 'qa/planner/run-all.sh', cmd: 'sh', args: [path.join(dir, 'planner', 'run-all.sh')], timeout: 300000 }); /* 13 suites, about 70 s in total */

const tail = (s, n = 15) => s.trim().split('\n').slice(-n).join('\n');
let failed = 0;
for (const t of files) {
  const r = spawnSync(t.cmd, t.args, { cwd: root, encoding: 'utf8', timeout: t.timeout || 60000, maxBuffer: 32 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) console.log('PASS ' + t.label);
  else {
    failed++;
    console.log('FAIL ' + t.label + (r.error ? ' (' + r.error.code + ')' : ' (exit ' + r.status + ')'));
    console.log(tail(out).replace(/^/gm, '    '));
  }
}
console.log(failed ? `\n${failed} of ${files.length} test files FAILED` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
