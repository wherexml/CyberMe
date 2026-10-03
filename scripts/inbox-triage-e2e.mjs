import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.TRIAGE_API||'http://127.0.0.1:46110';
const output=new URL('../output/inbox-triage-20261002/',import.meta.url);
await mkdir(output,{recursive:true});
const marker=`OPSADV-QA-TRIAGE-${Date.now()}`;
const evidence={marker,base,checks:[],cases:[]};
async function request(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const data=await r.json();return {status:r.status,data};}
function check(name,condition){evidence.checks.push({name,status:condition?'PASS':'FAIL'});assert.ok(condition,name);}
try{
 const cases=[
  ['fyi','通知：本次例行维护已完成，仅供知悉，无需回复。','no_reply'],
  ['ack','收到，谢谢你，问题已经解决，不需要再回复。','no_reply'],
  ['quick','Steve，请确认你是否收到了这条消息，回一句收到即可。','quick_reply'],
  ['deep','Steve，请你今天回复一份深入的战略分析报告。这是一次完整资料的假设决策练习，所有判断只以本段为准，无需外部信息。公司现金300万元，预算上限150万元，交付截止12月1日。方案A投入100万元，10月15日可上线；有30%概率因单一外包供应商停产延迟45天，延迟损失60万元；高需求收益240万元、低需求收益80万元。方案B投入140万元，11月1日上线；供应商双源，延迟概率5%、延迟30天、损失40万元；高需求收益220万元、低需求收益110万元。高需求概率60%。请综合期望收益、现金风险、交付风险、供应商依赖和风险偏好给出取舍，分析需求概率和延迟损失变化时的敏感性，并列出每种方案的缓解措施。这是经营者的重要选择，不能只计算一个数字或简单确认。','deep_reply'],
  ['deep-missing','Steve，请分析新工厂两种产能规划方案的优劣和风险并给出建议，资料尚未提供。','review'],
  ['missing','Please add a chart of related work. There is no linked task or data. Do not fabricate a chart.','review'],
  ['other','Dear 蒋鸿洲, your interview is confirmed. 蒋鸿洲 please reply to confirm attendance. This invitation is for 蒋鸿洲 only; Steve is copied for information.','no_reply']
 ];
 for(const [label,body,route] of cases){
  const created=await request('/api/inbox','POST',{title:`${marker}-${label}`,sender:'Inbox triage E2E',body,channel:'Internal',origin:'human',status:'pending'});assert.equal(created.status,201);
  const item=created.data;
  const [a,b]=await Promise.all([request(`/api/inbox/${item.id}/triage`,'POST',{}),request(`/api/inbox/${item.id}/triage`,'POST',{})]);
  check(`${label}: real Jev decision`,a.status===200&&a.data.status==='succeeded'&&a.data.model.startsWith('jev-'));
  evidence.cases.push({label,id:item.id,input:body,expected:route,triage:a.data});
  check(`${label}: route ${route}`,a.data.route===route);
  check(`${label}: concurrent requests share result`,a.data.completedAt===b.data.completedAt);
  const cached=await request(`/api/inbox/${item.id}/triage`,'POST',{});
  check(`${label}: cached without new inference`,cached.data.completedAt===a.data.completedAt);
  const fresh=(await request(`/api/inbox/${item.id}`)).data;
  check(`${label}: source edit lease unchanged`,fresh.updatedAt===item.updatedAt);
  check(`${label}: analysis does not generate draft, send or archive`,!fresh.draft&&!fresh.receipt&&!fresh.approved&&fresh.status==='pending');
 }
 // Keep semantic fixtures unchanged so the browser can repeat all expected routes.
 const sourceFixture=await request('/api/inbox','POST',{title:`${marker}-source-invalidation`,sender:'Inbox triage E2E',body:'仅供知悉，无需回复。',channel:'Internal',origin:'human',status:'pending'});
 assert.equal(sourceFixture.status,201);
 const itemId=sourceFixture.data.id;
 evidence.sourceInvalidationId=itemId;
 const initialSource=(await request(`/api/inbox/${itemId}/triage`,'POST',{})).data;
 const forged=await request(`/api/inbox/${itemId}`,'PATCH',{triage:{status:'succeeded',route:'no_reply'}});
 check('client cannot forge judgment',forged.status===403);
 await request(`/api/inbox/${itemId}`,'PATCH',{body:'Steve，请确认收到此消息。回复收到即可。'});
 check('changed source invalidates saved judgment',!(await request(`/api/inbox/${itemId}`)).data.triage);
 const rerun=await request(`/api/inbox/${itemId}/triage`,'POST',{});
 check('changed source receives fresh judgment',rerun.data.route==='quick_reply'&&rerun.data.sourceVersion!==initialSource.sourceVersion);
 const refresh=await request('/api/bootstrap');
 check('bootstrap preserves fresh judgment',refresh.data.inbox.find(i=>i.id===itemId)?.triage?.sourceVersion===rerun.data.sourceVersion);
 const saved=await request(`/api/inbox/${itemId}`,'PATCH',{draft:'用户手写回复',approved:true});
 const reassess=await request(`/api/inbox/${itemId}/triage`,'POST',{force:true});
 const latest=(await request(`/api/inbox/${itemId}`)).data;
 check('manual draft and approval preserved',reassess.data.status==='succeeded'&&latest.draft==='用户手写回复'&&latest.approved===saved.data.approved);
 evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.error=String(error);process.exitCode=1;}
await writeFile(new URL('http-e2e.json',output),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({status:evidence.status,marker,checks:evidence.checks,error:evidence.error},null,2));
