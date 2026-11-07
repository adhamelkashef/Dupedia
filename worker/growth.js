/* Growth operations: role-limited sales summaries and atomic, checked handoffs/interactions. */
import '../app/growth.js';
const G = globalThis.DPGrowth;
const fail = (http, message) => { throw Object.assign(new Error(message), { http }); };
const cleanId = x => typeof x === 'string' && /^[A-Za-z0-9_.~:@+-]{1,160}$/.test(x);
const stamp = () => new Date().toISOString();
const id = prefix => prefix + crypto.randomUUID();
const read = async (env, path) => { const row = await env.DB.prepare('SELECT path, data, v FROM docs WHERE path = ?').bind(path).first(); return row ? { ...row, doc: JSON.parse(row.data) } : { path, v: 0, doc: null }; };
const rows = async (env, where) => ((await env.DB.prepare('SELECT path, data, v FROM docs WHERE '+where).all()).results || []).map(r=>({...r,doc:JSON.parse(r.data)}));
const put = (env,path,data,at) => env.DB.prepare('INSERT INTO docs (path,parent,data,v,at) VALUES (?,?,?,1,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data,v=docs.v+1,at=excluded.at').bind(path,path.split('/').slice(0,-1).join('/'),JSON.stringify(data),at);
// Every assertion and write executes in the same D1 transaction. A changed read aborts the entire batch.
async function commit(env, expected, writes, sets=[]) {
  const checks=expected.map(r=>env.DB.prepare("SELECT CASE WHEN COALESCE((SELECT v FROM docs WHERE path=?),0)=? THEN 1 ELSE json('growth-conflict') END").bind(r.path,r.v));
  for(const {where,list} of sets) checks.push(env.DB.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM docs WHERE "+where+")=? AND (SELECT COALESCE(SUM(v),0) FROM docs WHERE "+where+")=? THEN 1 ELSE json('growth-conflict') END").bind(list.length,list.reduce((s,r)=>s+r.v,0)));
  try { await env.DB.batch([...checks,...writes]); } catch(e) { if (/malformed JSON/i.test(e.message)) fail(409,'This record changed while you were working. Reload it and try again.'); throw e; }
}
const history = (d, uid, action, detail, at) => ({...d, updatedAt:at,updatedBy:uid,history:[...(d.history||[]),{at,by:uid,action,detail}].slice(-120)});
const access = async (env,acc,auth) => ({admin:auth.isAdmin(acc),role:await auth.role(env,acc.uid)});
export async function growthSales(env,acc,auth) {
  const a=await access(env,acc,auth);
  if(!a.admin&&a.role!=='marketing') fail(403,'Growth sales summaries are available to Marketing and administrators.');
  const all=await rows(env,"parent='orders' OR parent GLOB 'submissions/*/s'");
  const subs=[],orders=[];
  for(const row of all){const d=row.doc;if(row.path.startsWith('submissions/')){
    const q={...d,id:row.path.split('/').pop(),pid:d.pid||row.path.split('/').pop(),ownerId:row.path.split('/')[1]};
    subs.push(a.admin?q:Object.fromEntries(['id','pid','ownerId','leadId','oid','orderId','status','issuedAt','at','updatedAt','rev'].filter(k=>q[k]!=null).map(k=>[k,q[k]])));
  }else{const o={...d,oid:d.oid||row.path.split('/').pop()};orders.push(a.admin?o:Object.fromEntries(['oid','pid','ownerId','leadId','status','acceptedAt','bookedAt','approvedAt'].filter(k=>o[k]!=null).map(k=>[k,o[k]])));}}
  return {subs,orders,full:a.admin,salesAvailable:true};
}
export async function growthHandoff(env,acc,b,auth){
  const a=await access(env,acc,auth);if(!a.admin&&a.role!=='marketing')fail(403,'Only Marketing and administrators can hand accounts to Sales.');
  if(!cleanId(b.accountId))fail(400,'Choose a Radar account.');
  const account=await read(env,'mkt/radar/a/'+b.accountId),r=account.doc;if(!r)fail(404,'Account not found.');
  if(r.qualification!=='qualified')fail(400,'Qualify this account before sending it to Sales. Disqualified accounts cannot be handed off.');
  if(!cleanId(r.ownerUid))fail(400,'Choose a salesperson as the account owner before handing it off.');
  const user=await env.DB.prepare('SELECT uid,name,active FROM users WHERE uid=?').bind(r.ownerUid).first();
  if(!user||!user.active||!['employee','admin'].includes(await auth.role(env,r.ownerUid)))fail(400,'The selected owner must be an active salesperson or administrator.');
  const campaign = r.campaignId ? await read(env, 'mkt/camp/c/'+r.campaignId) : null;
  if (campaign && !campaign.doc) fail(400,'The linked campaign no longer exists. Correct the Radar account before handoff.');
  const all=await rows(env,"parent='leads'"), norm=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const candidates=all.filter(x=>!['merged','archived'].includes(x.doc.status)&&norm(x.doc.name)===norm(r.company));
  let lead=r.leadId?all.find(x=>x.path==='leads/'+r.leadId):null;
  if(!lead&&candidates.length>1)fail(409,'Several matching leads exist. Ask an administrator to resolve the duplicates first.');
  lead=lead||candidates[0];
  if(lead&&['merged','archived','disqualified'].includes(lead.doc.status))fail(409,'The linked lead is closed or disqualified. Ask an administrator to review it.');
  const claimRows=await rows(env,"parent GLOB 'claims/*/c'");
  const lid=lead?lead.path.split('/').pop():id('L-');
  const claims=claimRows.filter(x=>x.path.split('/').pop()===lid);
  const owners=new Set([lead&&lead.doc.assignedTo,...claims.map(x=>x.doc.uid)].filter(Boolean));
  if([...owners].some(uid=>uid!==r.ownerUid))fail(409,'The matching lead already belongs to another salesperson. Ask an administrator to reconcile ownership before handing it off.');
  const existing=!!lead, originalCampaign=lead&&lead.doc.campaignId||null;
  if(b.expectedVersion != null && b.expectedVersion !== account.v) fail(409,'The account changed after your review. Review the handoff again.');
  if(b.preview)return{preview:true,accountVersion:account.v,ownerName:user.name||r.ownerUid,existed:existing,leadId:existing?lid:null,leadName:lead?lead.doc.name:r.company,ownerUid:r.ownerUid,sourcePreserved:existing,originalCampaign,campaignId:r.campaignId||null};
  if(existing&&b.expectedLeadId!==lid)fail(409,'A matching lead exists. Review the handoff again before linking it.');
  if(!existing&&b.expectedLeadId)fail(409,'The matching lead changed. Review the handoff again.');
  // Repeated submission of an already committed handoff is a read, not another assignment or interaction.
  if(r.leadId===lid&&r.handoffAt&&claims.some(x=>x.doc.uid===r.ownerUid))return{leadId:lid,existed:true,alreadyLinked:true,ownerUid:r.ownerUid,sourcePreserved:true};
  const at=stamp(),c0=(r.contacts||[])[0]||{};
  let next=lead?{...lead.doc}:{name:r.company,orgType:G.SEG_TO_ORG[r.segment]||'other',country:'Egypt',location:r.location||'',website:r.website||'',projects:[r.project,r.products].filter(Boolean).join(' — '),evidence:r.notes||'',sources:r.sources||[],contact:{name:c0.name||'',title:c0.role||'',phone:c0.phone||'',email:c0.email||'',source:c0.source||'',sub:'none'},qualification:{},status:'available',origin:'Marketing (Project Radar / campaign)',originKind:'marketing',campaignId:r.campaignId||null,radarId:b.accountId,createdAt:at,createdBy:acc.uid};
  const hadOwner=owners.has(r.ownerUid);
  if(!hadOwner)Object.assign(next,{assignedTo:r.ownerUid,assignedAt:at,assignedBy:acc.uid,assignReason:'Qualified Radar handoff',assignTimer:true});
  next=history(next,acc.uid,existing?'Radar account linked':'Qualified Radar handoff',b.accountId,at);
  const crm=await read(env,`crm/${r.ownerUid}/l/${lid}`),claim=await read(env,`claims/${r.ownerUid}/c/${lid}`);
  const expected=[account,crm,claim,...(campaign?[campaign]:[]),...(lead?[lead]:[{path:'leads/'+lid,v:0}])];
  const writes=[put(env,'leads/'+lid,next,at),put(env,account.path,history({...r,leadId:lid,handoffAt:at,handoffBy:acc.uid},acc.uid,existing?'Linked existing lead':'Sent to the Lead Mine',lid,at),at)];
  if(!claim.doc)writes.push(put(env,claim.path,{leadId:lid,uid:r.ownerUid,claimedAt:at,via:'admin',by:acc.uid,leadName:next.name},at));
  if(!crm.doc)writes.push(put(env,crm.path,{leadId:lid,uid:r.ownerUid,stage:'claimed',updatedAt:at,notes:[{at,text:'Qualified Radar handoff',system:true}],stageHistory:[{stage:'claimed',at,note:'Qualified Radar handoff'}]},at));
  if(existing&&r.campaignId&&r.campaignId!==originalCampaign)writes.push(put(env,`mkt/touch/t/handoff-${b.accountId}`,{kind:'referral',accountId:b.accountId,leadId:lid,campaignId:r.campaignId,by:acc.uid,at,note:'Radar handoff; existing first source preserved'},at));
  writes.push(put(env,`notif/${r.ownerUid}/n/radar-handoff-${b.accountId}`,{id:'radar-handoff-'+b.accountId,from:acc.uid,type:'lead',title:existing?'Existing lead linked from Radar':'Qualified Radar lead assigned to you',body:r.company,read:false,at,link:{view:'myleads'},ref:lid},at));
  await commit(env,expected,writes,[{where:"parent='leads'",list:all},{where:"parent GLOB 'claims/*/c'",list:claimRows}]);
  return{leadId:lid,existed:existing,ownerUid:r.ownerUid,sourcePreserved:existing};
}
export async function growthInteraction(env,acc,b,auth){
  const a=await access(env,acc,auth);if(!a.admin&&(!a.role||a.role==='viewer'))fail(403,'View-only access cannot log interactions.');
  if(!G.TOUCH[b.kind]||!cleanId(b.id))fail(400,'Choose an interaction type.');
  for(const key of ['accountId','partnerId','leadId','campaignId'])if(b[key]&&!cleanId(b[key]))fail(400,'Invalid linked record.');
  if(!b.accountId&&!b.partnerId&&!b.leadId)fail(400,'Link the interaction to an account, partner or lead.');
  if(b.accountId&&b.partnerId)fail(400,'Choose one follow-up record.');
  const at=b.at||stamp();if(!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now()+60000)fail(400,'The interaction date cannot be in the future.');
  const action=String(b.nextAction||'').trim().slice(0,300),due=b.nextDue||null;
  if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due))))fail(400,'Choose a valid follow-up date.');
  if(due&&!action)fail(400,'Enter the next action for this follow-up date.');
  if((action||due)&&!b.accountId&&!b.partnerId)fail(400,'Schedule the follow-up on a Radar account or partner.');
  const links=[];for(const [key,prefix]of [['accountId','mkt/radar/a/'],['partnerId','mkt/part/p/'],['leadId','leads/'],['campaignId','mkt/camp/c/']])if(b[key]){const row=await read(env,prefix+b[key]);if(!row.doc)fail(404,'A linked record no longer exists. Reload it.');links.push(row);}
  const target=links.find(x=>x.path.startsWith('mkt/radar/')||x.path.startsWith('mkt/part/'));
  if(action&&target&&!a.admin&&a.role!=='marketing'&&target.doc.ownerUid!==acc.uid)fail(403,'Only the owner or Marketing can schedule this follow-up.');
  const touch=await read(env,'mkt/touch/t/'+b.id);if(touch.doc)fail(409,'This interaction has already been recorded. Reload the record.');
  const recorded=stamp(),rec={kind:b.kind,at,by:acc.uid,accountId:b.accountId||null,partnerId:b.partnerId||null,leadId:b.leadId||null,campaignId:b.campaignId||null,note:String(b.note||'').slice(0,600),outcome:String(b.outcome||'').slice(0,200)};
  const writes=[put(env,touch.path,rec,recorded)];
  if(action&&target){const field=b.accountId?'nextDue':'followUp';writes.push(put(env,target.path,history({...target.doc,nextAction:action,[field]:due},acc.uid,'Interaction and next action recorded',b.id,recorded),recorded));}
  await commit(env,[touch,...links],writes);return{id:b.id,...rec,followUpSaved:!!action};
}
