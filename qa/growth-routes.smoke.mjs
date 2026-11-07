/* Local-only Worker integration checks. Never target production. */
import assert from 'node:assert/strict';
import '../app/growth.js';
const BASE=process.argv[2]||'http://localhost:8789';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE))throw Error('Local test server only');
const G=globalThis.DPGrowth;let checks=0;
async function call(path,body,cookie){const r=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-xf':'1',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,j:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
function ok(v,label){assert.ok(v,label);checks++;console.log('PASS '+label)}
let a=await call('/api/setup',{code:'local-growth-fixture-only',username:'growth.owner',name:'Growth Local Owner',password:'Growth-Local-Owner-1'});
if(a.status===410)a=await call('/api/login',{username:'growth.owner',password:'Growth-Local-Owner-1'});const admin=a.cookie;ok(admin,'local owner authenticated');
const me=(await call('/api/me',null,admin)).j,uid=me.uid;
const set=async(path,data,cookie=admin)=>call('/api/db',{op:'set',path,data},cookie);
const get=async(path,cookie=admin)=>(await call('/api/db',{op:'get',path},cookie)).j.data;
await set('directory/'+uid,{uid,name:'Growth Local Owner',role:'admin',active:true});
let mk=await call('/api/accounts',{username:'growth.marketing',name:'Growth Local Marketing',level:'interact',password:'Growth-Local-Staff-1'},admin);
let login=await call('/api/login',{username:'growth.marketing',password:'Growth-Local-Staff-1'});
let staff;if(mk.status===200){await call('/api/password',{old:'Growth-Local-Staff-1',password:'Growth-Local-Staff-2'},login.cookie);staff=(await call('/api/login',{username:'growth.marketing',password:'Growth-Local-Staff-2'})).cookie;}else staff=(await call('/api/login',{username:'growth.marketing',password:'Growth-Local-Staff-2'})).cookie;
const sm=(await call('/api/me',null,staff)).j;await set('directory/'+sm.uid,{uid:sm.uid,name:'Growth Local Marketing',role:'marketing',active:true});ok(staff,'local Marketing user authenticated');
let draft={name:'Local schools',objective:'Meetings',segment:'school',channels:['email'],products:[],ownerUid:uid,source:'LOCAL-TEST',status:'draft',content:[]};
let r=await set('mkt/camp/c/test',draft);ok(!r.j.error,'draft saved');r=await set('mkt/camp/c/test',{...draft,status:'paused'},staff);ok(!r.j.error,'Marketing can pause draft');r=await set('mkt/camp/c/test',{...draft,status:'live'},staff);ok(r.j.error,'Worker rejects paused-to-live approval bypass');
const approved=G.prepareApproval(null,{...draft},{admin:true,approve:true,by:uid,at:new Date().toISOString()});r=await set('mkt/camp/c/test',approved);ok(!r.j.error,'Worker accepts admin approval of exact version');
r=await set('mkt/camp/c/test',{...approved,budgetMinor:99900},staff);ok(r.j.error,'Worker rejects changed budget with stale approval');
r=await set('mkt/camp/c/test',{...approved,status:'live'},staff);ok(!r.j.error,'Worker accepts starting unchanged approved version');
const content=G.prepareApproval(null,{id:'post',kind:'post',date:'2026-11-07',caption:'Approved copy',assets:[],status:'draft'},{kind:'content',admin:true,approve:true,by:uid,at:new Date().toISOString()});
r=await set('mkt/camp/c/test',{...approved,content:[content]});ok(!r.j.error,'approved content saved');r=await set('mkt/camp/c/test',{...approved,content:[{...content,caption:'Changed copy'}]},staff);ok(r.j.error,'Worker rejects stale content approval');
const account={company:'Local test school',segment:'school',ownerUid:sm.uid,nextAction:'Call',nextDue:'2026-11-07'};await set('mkt/radar/a/test',account);
const completion={id:'local-completion',due:account.nextDue,action:account.nextAction,completedAt:new Date().toISOString(),completedBy:sm.uid,outcome:'Completed the call'};
r=await set('mkt/radar/a/test',{...account,nextDue:null,nextAction:'',followUpCompletions:[completion]},staff);ok(!r.j.error,'Worker accepts explicit completion');
r=await set('mkt/radar/a/test',{...account,followUpCompletions:[]},staff);ok(r.j.error,'Worker rejects rewriting completion history');
// Browser fixtures: two newly acquired leads; two quotes to only one lead (50% conversion).
await set('mkt/camp/c/fixture',{...draft,name:'Local reporting fixture',source:'LOCAL-REPORT',status:'draft'});
for(const id of ['a','b'])await set('leads/'+id,{name:'Local lead '+id,orgType:'school',location:'Cairo',createdAt:'2026-11-01T12:00:00Z',campaignId:'fixture',assignedTo:uid,qualification:{}});
for(const pid of ['quote1','quote2'])await set(`submissions/${uid}/s/${pid}`,{pid,ownerId:uid,leadId:'a',issuedAt:'2026-11-02T12:00:00Z',at:'2026-11-02T12:00:00Z',status:'submitted',base:{totalMinor:10000}});
console.log(`${checks} local Worker integration checks passed`);
