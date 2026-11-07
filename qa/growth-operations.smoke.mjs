/* Real Worker checks: localhost only; run growth-routes.smoke.mjs first for test accounts. */
import assert from 'node:assert/strict';
const BASE=process.argv[2]||'http://localhost:8789';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE))throw Error('Local test server only');
let n=0;const suffix=Date.now().toString(36);
async function call(path,body,cookie){const r=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-xf':'1',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,j:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const check=(v,label)=>{assert.ok(v,label);n++;console.log('PASS '+label)};
const login=async(username,password)=>(await call('/api/login',{username,password})).cookie;
const admin=await login('growth.owner','Growth-Local-Owner-1'),marketing=await login('growth.marketing','Growth-Local-Staff-2');check(admin&&marketing,'test users authenticated');
const uid=(await call('/api/me',null,admin)).j.uid;
const set=async(path,data)=>{const r=await call('/api/db',{op:'set',path,data},admin);assert.ok(!r.j.error,JSON.stringify(r));};
const get=async path=>(await call('/api/db',{op:'get',path},admin)).j.data;
const c1='op-c1-'+suffix,c2='op-c2-'+suffix;
for(const c of [c1,c2])await set('mkt/camp/c/'+c,{name:c,objective:'Local test',segment:'school',status:'draft',channels:['email'],content:[]});
const aid='op-a-'+suffix,acct={company:'Operations school '+suffix,segment:'school',qualification:'qualified',ownerUid:uid,campaignId:c1};await set('mkt/radar/a/'+aid,acct);
const handoff=(b,c=marketing)=>call('/api/growth/handoff',{accountId:aid,...b},c);
let r=await handoff({preview:true});check(r.status===200&&!r.j.existed,'new handoff preview');check(!(await get('mkt/radar/a/'+aid)).leadId,'preview writes nothing');
r=await handoff({});check(r.status===200&&!r.j.existed,'Marketing hands qualified account to Sales');const lid=r.j.leadId;
check((await get('leads/'+lid)).assignedTo===uid,'lead assigned to selected Sales owner');check((await get(`claims/${uid}/c/${lid}`)).uid===uid,'Sales claim created');check((await get(`crm/${uid}/l/${lid}`)).stage==='claimed','Sales CRM created');check((await get('mkt/radar/a/'+aid)).leadId===lid,'Radar links to lead');check((await get('leads/'+lid)).campaignId===c1,'new lead retains campaign first source');
r=await handoff({expectedLeadId:lid});check(r.status===200&&r.j.alreadyLinked,'repeated handoff is idempotent');
const dup='op-dup-'+suffix;await set('mkt/radar/a/'+dup,{...acct,campaignId:c2});
r=await call('/api/growth/handoff',{accountId:dup},marketing);check(r.status===409,'duplicate requires reviewed match');
r=await call('/api/growth/handoff',{accountId:dup,preview:true},marketing);check(r.j.existed&&r.j.leadId===lid,'preview identifies existing lead');
r=await call('/api/growth/handoff',{accountId:dup,expectedLeadId:lid},marketing);check(r.status===200&&r.j.existed,'existing match links without duplicate');check((await get('leads/'+lid)).campaignId===c1,'existing first source preserved');check((await get('mkt/touch/t/handoff-'+dup)).campaignId===c2,'later campaign recorded as influence');
for(const qualification of ['disqualified',null]){await set('mkt/radar/a/'+aid,{...acct,qualification});r=await handoff({});check(r.status===400,'rejects '+qualification+' qualification')}
await set('mkt/radar/a/'+aid,{...acct,ownerUid:null});r=await handoff({});check(r.status===400,'rejects missing Sales owner');
// Separate Sales account to verify ownership conflicts and role enforcement.
const username='op.sales.'+suffix;let a=await call('/api/accounts',{username,name:'Operations Local Sales',level:'interact',password:'Operations-Local-Sales-1'},admin);check(a.status===200,'local salesperson created');let sales=await login(username,'Operations-Local-Sales-1');await call('/api/password',{old:'Operations-Local-Sales-1',password:'Operations-Local-Sales-2'},sales);sales=await login(username,'Operations-Local-Sales-2');const suid=(await call('/api/me',null,sales)).j.uid;await set('directory/'+suid,{uid:suid,role:'employee',active:true,name:'Operations Local Sales'});
await set('mkt/radar/a/'+aid,{...acct,ownerUid:suid});r=await handoff({preview:true});check(r.status===409,'does not steal another owner’s matching lead');r=await handoff({},sales);check(r.status===403,'Sales cannot invoke Marketing handoff');
const partner='op-p-'+suffix;await set('mkt/part/p/'+partner,{name:'Operations partner',ownerUid:suid,status:'active',nextAction:'Old',followUp:'2026-11-07'});
const touch='op-t-'+suffix;const interaction={id:touch,partnerId:partner,kind:'meeting',at:new Date().toISOString(),nextAction:'Send proposal',nextDue:'2026-11-10',outcome:'Meeting complete'};
r=await call('/api/growth/interaction',interaction,sales);check(r.status===200&&r.j.followUpSaved,'owner records partner interaction and next action');const p=await get('mkt/part/p/'+partner);check(p.nextAction==='Send proposal'&&p.followUp==='2026-11-10','partner action and due date persist');check((await get('mkt/touch/t/'+touch)).by===suid,'interaction author stamped by server');
r=await call('/api/growth/interaction',interaction,sales);check(r.status===409,'duplicate interaction submission refused');
await set('mkt/radar/a/'+aid,{...acct,ownerUid:suid});r=await call('/api/growth/interaction',{...interaction,id:touch+'a',partnerId:null,accountId:aid},sales);check(r.status===200&&(await get('mkt/radar/a/'+aid)).nextDue==='2026-11-10','account interaction and next action persist');
await set('mkt/part/p/'+partner,{name:'Other owner',ownerUid:uid});r=await call('/api/growth/interaction',{...interaction,id:touch+'b'},sales);check(r.status===403&&!(await get('mkt/touch/t/'+touch+'b')),'unauthorized follow-up fails without saving interaction');r=await call('/api/growth/interaction',{...interaction,id:touch+'c',nextAction:''},marketing);check(r.status===400&&!(await get('mkt/touch/t/'+touch+'c')),'date without action fails without partial write');
await set(`submissions/${uid}/s/op-${suffix}`,{pid:'op-'+suffix,leadId:lid,status:'submitted',issuedAt:'2026-11-01',base:{totalMinor:999000},privateNote:'secret',salary:999});await set('orders/op-'+suffix,{oid:'op-'+suffix,leadId:lid,ownerId:uid,pid:'op-'+suffix,status:'approved',acceptedAt:'2026-11-02',totalMinor:999000,costMinor:123000,payments:[{amountMinor:50000}],client:'private client'});
r=await call('/api/growth/sales',null,marketing);check(r.status===200&&r.j.salesAvailable&&!r.j.full,'Marketing receives count-only sales summary');check(r.j.subs.some(x=>x.pid==='op-'+suffix)&&r.j.orders.some(x=>x.oid==='op-'+suffix),'summary includes real quotation/order keys');check(!/totalMinor|costMinor|amountMinor|payments|secret|private client|salary|privateNote/.test(JSON.stringify(r.j)),'no financial amounts or private payloads leak');
r=await call('/api/growth/sales',null,sales);check(r.status===403,'unrelated roles cannot read Growth sales summary');r=await call('/api/growth/sales',null,admin);check(r.j.full&&r.j.orders.find(x=>x.oid==='op-'+suffix).totalMinor===999000,'admin retains full financial results');
// Concurrent requests must either commit once or return a retryable conflict.
const race='op-race-'+suffix;await set('mkt/radar/a/'+race,{...acct,company:'Race school '+suffix});const rr=await Promise.all([1,2].map(()=>call('/api/growth/handoff',{accountId:race},marketing)));check(rr.some(x=>x.status===200)&&rr.every(x=>[200,409].includes(x.status)),'concurrent handoffs resolve with a safe conflict');
const linked=await get('mkt/radar/a/'+race),leads=(await call('/api/db',{op:'list',path:'leads'},admin)).j.docs;check(leads.filter(x=>x.data.name==='Race school '+suffix).length===1&&linked.leadId,'concurrent handoffs create exactly one lead');
console.log(`${n} Growth operations integration checks passed`);
