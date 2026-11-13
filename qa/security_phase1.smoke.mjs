/* Local-only Worker integration checks for X FORCE Security Phase 1. Never target production. */
import assert from 'node:assert/strict';
const BASE=process.argv[2]||'http://localhost:8790';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE))throw Error('Local test server only');
const SETUP='local-security-fixture-only';let checks=0;
async function call(path,body,cookie,extra){const r=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-xf':'1',...(cookie?{cookie}:{}),...(extra||{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}return{status:r.status,j,text,headers:r.headers,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
function ok(v,label){assert.ok(v,label);checks++;console.log('PASS '+label)}
/* ===== FIXTURES: owner, admin, staff, mustChange (cookies) and ownerUid, adminUid, staffUid. Add new checks below the end marker. ===== */
const PW1='Sec-Local-Pass-1',PW2='Sec-Local-Pass-2';
let a=await call('/api/setup',{code:SETUP,username:'sec.owner',name:'Security Local Owner',password:PW1});
if(a.status===410)a=await call('/api/login',{username:'sec.owner',password:PW1});
const owner=a.cookie;ok(owner,'local owner authenticated');
async function account(username,level){
  const mk=await call('/api/accounts',{username,name:'Security '+username,level,password:PW1},owner);
  const first=await call('/api/login',{username,password:PW1});
  if(mk.status===200){await call('/api/password',{old:PW1,password:PW2},first.cookie);return(await call('/api/login',{username,password:PW2})).cookie;}
  return(await call('/api/login',{username,password:PW2})).cookie;
}
const admin=await account('sec.admin','admin'),staff=await account('sec.staff','interact');
await call('/api/accounts',{username:'sec.fresh',name:'Security fresh',level:'interact',password:PW1},owner);
const mustChange=(await call('/api/login',{username:'sec.fresh',password:PW1})).cookie;
const ownerUid=(await call('/api/me',null,owner)).j.uid,adminUid=(await call('/api/me',null,admin)).j.uid,staffUid=(await call('/api/me',null,staff)).j.uid;
ok(admin&&staff&&mustChange&&ownerUid&&adminUid&&staffUid,'fixture accounts ready');
/* ===== END FIXTURES ===== */
// Task 2: /data is for signed-in administrators only; Markdown and unused data are not deployed
ok((await call('/data/leadseed.js')).status===401,'anonymous gets 401 on /data');
ok((await call('/data/leadseed.js',null,staff)).status===403,'staff gets 403 on /data');
const adminData=await call('/data/leadseed.js',null,admin);
ok(adminData.status===200,'admin session loads /data/leadseed.js');
ok(/no-store/.test(adminData.headers.get('cache-control')||''),'/data responses are not cached (no-store)');
ok((await call('/data/leadseed.js',null,mustChange)).status===403,'must-change session gets 403 on /data');
ok((await call('/data/leadseed.json',null,admin)).status===404,'leadseed.json is no longer deployed');
ok((await call('/XFORCE-1.4.6.md')).status===404,'markdown files are not served');
// Task 3: administrators cannot reset the owner; the owner recovers with the setup code; account changes are audited
async function auditList(cookie){return(await call('/api/db',{op:'list',path:'audit'},cookie)).j?.docs||[]}
async function auditCount(cookie){return(await auditList(cookie)).length}
async function auditHas(cookie,action){return(await auditList(cookie)).some((d)=>d.data&&d.data.action===action)}
let r = await call(`/api/accounts/${ownerUid}/reset`, { mode: 'temp' }, admin);
ok(r.status === 403 && r.j.error === 'owner', 'admin cannot issue a temporary password for the owner');
r = await call(`/api/accounts/${ownerUid}/reset`, { mode: 'link' }, admin);
ok(r.status === 403 && r.j.error === 'owner', 'admin cannot send the owner a reset link');
r = await call(`/api/accounts/${ownerUid}`, { password: 'Admin-Chosen-Pass-1' }, admin);
ok(r.status === 403 && r.j.error === 'owner', 'admin cannot set the owner password');
r = await call(`/api/accounts/${ownerUid}`, { name: 'Owner Renamed' }, admin);
ok(r.status === 200, 'admin can still rename the owner');
const before = await auditCount(owner);
r = await call(`/api/accounts/${staffUid}`, { password: 'short' }, admin);
ok(r.status === 400 && (await auditCount(owner)) === before, 'rejected admin-set password writes no audit entry');
await call('/api/accounts', { username: 'sec.audit', name: 'Audit Check', level: 'interact', password: 'Audit-Check-Pass-1' }, admin);
ok(await auditHas(owner, 'Account created'), 'account creation is audited');
await call(`/api/accounts/${staffUid}`, { level: 'finance' }, admin);
ok(await auditHas(owner, 'Access level changed'), 'level change is audited');
await call(`/api/accounts/${staffUid}`, { active: false }, admin);
ok(await auditHas(owner, 'Account deactivated'), 'deactivation is audited');
// the owner's directory e-mail receives the owner's reset link: only the owner may change it
const ownerDir = `directory/${ownerUid}`, db = (op, path, data, cookie) => call('/api/db', { op, path, data }, cookie);
r = await db('set', ownerDir, { uid: ownerUid, email: 'owner@example.test', firstName: 'Security', role: 'admin' }, owner);
ok(r.status === 200 && !r.j.error, 'owner sets up their directory record');
r = await db('set', ownerDir, { uid: ownerUid, email: 'attacker@example.test', firstName: 'Security', role: 'admin' }, admin);
ok(r.j && r.j.error, 'admin cannot change the owner e-mail');
r = await db('update', ownerDir, { firstName: 'Renamed' }, admin);
const dirNow = (await call('/api/db', { op: 'get', path: ownerDir }, owner)).j;
ok(r.j && !r.j.error && dirNow.data.firstName === 'Renamed' && dirNow.data.email === 'owner@example.test', 'admin can still edit the owner directory name');
r = await db('create', 'directory/sec-fake', { uid: ownerUid, email: 'attacker@example.test' }, admin);
ok(r.j && r.j.error, 'admin cannot create a second directory record for the owner');
r = await db('delete', ownerDir, undefined, admin);
ok(r.j && r.j.error && (await call('/api/db', { op: 'get', path: ownerDir }, owner)).j.exists, 'admin cannot delete the owner directory record');
r = await db('update', ownerDir, { email: 'owner2@example.test' }, owner);
ok(r.j && !r.j.error, 'owner can change their own e-mail');
// the owner's active status and role decide whether e-mail recovery works: administrators cannot change them either
const dirGet = async () => (await call('/api/db', { op: 'get', path: ownerDir }, owner)).j.data;
r = await db('update', ownerDir, { active: false }, admin);
ok(r.j && r.j.error && (await dirGet()).active !== false, 'admin cannot deactivate the owner directory record');
r = await db('update', ownerDir, { role: 'employee' }, admin);
ok(r.j && r.j.error && (await dirGet()).role === 'admin', 'admin cannot change the owner role');
r = await db('update', ownerDir, { email: ' OWNER2@EXAMPLE.test ' }, admin);
ok(r.j && r.j.error && (await dirGet()).email === 'owner2@example.test', 'admin cannot pad the owner e-mail with spaces');
r = await call('/api/recover', { code: SETUP, username: 'sec.admin', password: 'Recovered-Pass-1' });
ok(r.status === 403 && r.j.error === 'code', 'setup code does not recover a non-owner account');
r = await call('/api/recover', { code: SETUP, username: 'sec.owner', password: 'Recovered-Pass-1' });
ok(r.status === 200, 'owner recovers with the setup code');
ok((await call('/api/me', null, owner)).status === 401, 'recovery ends the owner\'s old sessions');
const back = await call('/api/login', { username: 'sec.owner', password: 'Recovered-Pass-1' });
ok(back.status === 200, 'owner signs in with the new password');
ok(await auditHas(back.cookie, 'Owner password recovered with the setup code'), 'recovery is audited');
// last: the address is locked afterwards (one failure above + 4 here = 5)
for (let i = 0; i < 4; i++) await call('/api/recover', { code: 'wrong-code', username: 'sec.owner', password: 'Recovered-Pass-2' });
ok((await call('/api/recover', { code: SETUP, username: 'sec.owner', password: 'Recovered-Pass-2' })).status === 429, 'recover locks after 5 failures');
// the owner username is locked too, whatever address the attempts come from (wrangler dev passes cf-connecting-ip through)
for (let i = 1; i <= 5; i++) await call('/api/recover', { code: 'wrong-code', username: 'sec.owner', password: 'Recovered-Pass-2' }, null, { 'cf-connecting-ip': '198.51.100.' + i });
r = await call('/api/recover', { code: SETUP, username: 'sec.owner', password: 'Recovered-Pass-2' }, null, { 'cf-connecting-ip': '198.51.100.99' });
ok(r.status === 429 && r.j.error === 'locked', 'recover locks the owner username across addresses');
console.log(`${checks} security phase 1 checks passed`);
