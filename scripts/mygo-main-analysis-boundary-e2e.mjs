import fs from 'node:fs/promises';
const checks=[],out='output/mygo-main-analysis-20261018/boundaries-'+Date.now();await fs.mkdir(out,{recursive:true});
const api=async(method,path,body)=>{const {token}=JSON.parse(await fs.readFile('.local/mygo-v17-public/connection.json'));const r=await fetch('http://127.0.0.1:46510'+path,{method,headers:{'content-type':'application/json','X-OpsTwins-Pilot':token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {http:r.status,data:await r.json()}};
const check=(name,pass)=>{checks.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
const wait=async fn=>{for(let n=0;n<100;n++){try{const x=await fn();if(x)return x}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('bounded readiness wait')};
const messages=async()=>(await api('GET','/api/conversations/main-analysis-primary/messages?limit=200')).data.items;
try{
 await wait(async()=>(await api('GET','/api/health')).http===200);
 check('恢复原公开事项',(await api('POST','/api/inbox/main-analysis-live/restore',{})).http===200);
 check('原生成只读发现后恢复成功状态',(await api('POST','/api/pilot/main-analysis',{action:'recover'})).http===200);
 await api('POST','/api/pilot/main-analysis',{action:'qualified'});
 const expected={ready:'ready',unknown:'unknown',candidate:'review',send_unknown:'unknown',failed:'failed',revoke:'ready'};
 for(const [kind,state]of Object.entries(expected)){
  const r=await api('POST','/api/pilot/main-analysis',{action:'case',kind});check('准备受控边界 '+kind,r.http===200);
  const m=await wait(async()=>(await messages()).find(m=>m.inboxAnalysis?.itemId===r.data.id&&m.inboxAnalysis.state===state));
  check('生产HTTP投影 '+kind,m.inboxAnalysis.state===state);
  if(kind==='candidate')check('候选未冒充已采用',m.content.includes('HUMAN-candidate')&&!m.content.includes('CANDIDATE-NOT-ADOPTED'));
  if(kind==='send_unknown')check('发送未确认不显示待发送草稿',!m.content.includes('HUMAN-send_unknown'));
  if(kind==='revoke'){await api('POST','/api/pilot/main-analysis',{action:'case',kind,revoke:true});const revoked=await wait(async()=>(await messages()).find(x=>x.id===m.id&&x.inboxAnalysis.state==='unavailable'));check('断开后撤下正文和草稿',!revoked.content.includes('HUMAN-')&&!revoked.content.includes('公开边界'))}
 }
 for(const kind of ['old_failure','closed','new_unavailable']){await api('POST','/api/pilot/main-analysis',{action:'case',kind});await api('GET','/api/bootstrap');await new Promise(r=>setTimeout(r,100));check('不刷历史静默事项 '+kind,!(await messages()).some(m=>m.inboxAnalysis?.itemId==='boundary-'+kind))}
 const revision=(await api('GET','/api/health')).data.revision;const b=(await api('GET','/api/bootstrap')).data;for(let i=0;i<3;i++)await messages();const a=(await api('GET','/api/bootstrap')).data;check('GET不引起持久写入',b.revision===a.revision);
 const before=(await messages()).filter(m=>m.inboxAnalysis),ids=before.map(m=>m.id);await new Promise(r=>setTimeout(r,3300));const after=(await messages()).filter(m=>m.inboxAnalysis);check('周期无变化零重复消息',JSON.stringify(ids)===JSON.stringify(after.map(m=>m.id)));check('全部仅绑定主会话',after.every(m=>m.conversationId==='main-analysis-primary'));await fs.writeFile(out+'/snapshot.json',JSON.stringify(after.map(m=>({id:m.id,createdAt:m.createdAt,updatedAt:m.updatedAt,inboxAnalysis:m.inboxAnalysis})),null,2));
}catch(e){await fs.writeFile(out+'/error.txt',String(e));throw e}finally{await fs.writeFile(out+'/result.json',JSON.stringify({checks,scope:'public controlled states through production HTTP; no simulated model success'},null,2));console.log({out,checks})}
