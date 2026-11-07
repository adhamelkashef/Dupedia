const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name)}
(async()=>{
const {growthHandoff,growthInteraction,growthSales}=await import('../worker/growth.js');
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE docs(path TEXT PRIMARY KEY,parent TEXT,data TEXT,v INTEGER,at TEXT); CREATE TABLE users(uid TEXT PRIMARY KEY,name TEXT,active INTEGER);');
let abort=false,race=false;
const DB={prepare(query){return{bind(...args){return{first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args),_query:query,_args:args}},all:async()=>({results:sql.prepare(query).all()})}},async batch(stmts){if(race){race=false;sql.exec("UPDATE docs SET v=v+1 WHERE path='mkt/radar/a/a'");}sql.exec('BEGIN');try{const out=[];for(let i=0;i<stmts.length;i++){if(abort&&i===stmts.length-1)throw Error('Injected storage failure');const s=stmts[i];out.push(sql.prepare(s._query).all(...s._args));}sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const env={DB},acc={uid:'m'},auth={isAdmin:()=>false,role:async(_,uid)=>uid==='s'?'employee':uid==='m'?'marketing':'viewer'};
function set(p,d){sql.prepare('INSERT INTO docs VALUES (?,?,?,1,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data,v=docs.v+1').run(p,p.split('/').slice(0,-1).join('/'),JSON.stringify(d),new Date().toISOString());}
const get=p=>{const r=sql.prepare('SELECT data FROM docs WHERE path=?').get(p);return r?JSON.parse(r.data):null};
sql.exec("INSERT INTO users VALUES ('s','Salesperson',1)");set('mkt/radar/a/a',{company:'School',ownerUid:'s',qualification:'qualified',campaignId:'c'});set('mkt/camp/c/c',{name:'Campaign'});
await test('storage failure rolls back the entire Sales handoff',async()=>{abort=true;await assert.rejects(growthHandoff(env,acc,{accountId:'a'},auth),/Injected/);abort=false;assert.equal(get('mkt/radar/a/a').leadId,undefined);assert.equal(sql.prepare("SELECT COUNT(*) n FROM docs WHERE parent='leads'").get().n,0);assert.equal(sql.prepare("SELECT COUNT(*) n FROM docs WHERE parent GLOB 'claims/*/c'").get().n,0)});
await test('concurrent edit aborts every handoff write',async()=>{race=true;await assert.rejects(growthHandoff(env,acc,{accountId:'a'},auth),e=>e.http===409);assert.equal(get('mkt/radar/a/a').leadId,undefined);assert.equal(sql.prepare("SELECT COUNT(*) n FROM docs WHERE parent='leads'").get().n,0)});
await test('handoff succeeds after retry',async()=>{const r=await growthHandoff(env,acc,{accountId:'a'},auth);assert.equal(get('leads/'+r.leadId).assignedTo,'s');assert.ok(get(`claims/s/c/${r.leadId}`));});
await test('stale handoff preview cannot commit changed account',async()=>{const preview=await growthHandoff(env,acc,{accountId:'a',preview:true},auth);const d=get('mkt/radar/a/a');set('mkt/radar/a/a',{...d,notes:'Changed after preview'});await assert.rejects(growthHandoff(env,acc,{accountId:'a',expectedLeadId:preview.leadId,expectedVersion:preview.accountVersion},auth),e=>e.http===409)});
set('leads/orphan',{name:'Orphan',status:'available',assignedTo:'s',campaignId:'old'});set('mkt/radar/a/orphan',{company:'Orphan',qualification:'qualified',ownerUid:'s'});
await test('legacy assignment without claim is repaired during handoff',async()=>{await growthHandoff(env,acc,{accountId:'orphan',expectedLeadId:'orphan'},auth);assert.ok(get('claims/s/c/orphan'));assert.ok(get('crm/s/l/orphan'));assert.equal(get('leads/orphan').campaignId,'old')});
set('mkt/part/p/p',{name:'Partner',ownerUid:'s',nextAction:'Old',followUp:'2026-11-01'});
await test('failed partner follow-up rolls back interaction and action',async()=>{abort=true;await assert.rejects(growthInteraction(env,{uid:'s'},{id:'t',kind:'meeting',partnerId:'p',nextAction:'New',nextDue:'2026-11-10'},auth),/Injected/);abort=false;assert.equal(get('mkt/touch/t/t'),null);assert.equal(get('mkt/part/p/p').nextAction,'Old')});
await test('follow-up succeeds after storage recovers',async()=>{await growthInteraction(env,{uid:'s'},{id:'t',kind:'meeting',partnerId:'p',nextAction:'New',nextDue:'2026-11-10'},auth);assert.equal(get('mkt/part/p/p').followUp,'2026-11-10')});
await test('future interaction cannot be recorded',async()=>assert.rejects(growthInteraction(env,acc,{id:'future',kind:'meeting',partnerId:'p',at:'2099-01-01'},auth),e=>e.http===400));
await test('viewer cannot log interactions',async()=>assert.rejects(growthInteraction(env,{uid:'viewer'},{id:'v',kind:'meeting',partnerId:'p'},auth),e=>e.http===403));
await test('failed sales query surfaces an error',async()=>assert.rejects(growthSales({DB:{prepare(){throw Error('Storage unavailable')}}},acc,auth),/Storage unavailable/));
let failing='';const c={console,Date,Map};c.self=c;c.DPAuth={A:{me:{id:'admin',role:'admin'},directory:[]},isAdmin:()=>true};c.DPFin={};
c.DPStore={get:async p=>{if(p===failing)throw Error('Read failed '+p);return null},list:async p=>{if(p===failing)throw Error('Read failed '+p);return []}};
vm.createContext(c);for(const f of ['growth','mkt'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/'+f+'.js'),'utf8'),c);
for(const p of ['mkt/cfg','mkt/camp/c','mkt/radar/a','mkt/part/p','mkt/touch/t','leads','orders','fin/tx/t'])await test('failed '+p+' read is never an empty result',async()=>{failing=p;await assert.rejects(c.DPMkt.snapshot(),/Read failed/)});
failing='';await test('genuinely empty data still loads',async()=>{const s=await c.DPMkt.snapshot();assert.equal(s.leads.length,0);assert.equal(s.salesAvailable,true)});
c.XFServer={api:async()=>{throw Error('Sales endpoint failed')}};await test('sales summary endpoint failure is visible',async()=>assert.rejects(c.DPMkt.snapshot(),/Sales endpoint failed/));
console.log(`${count} Growth data integrity checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
