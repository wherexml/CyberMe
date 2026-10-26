// Production HTTP through a private capability, public isolated data only.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const root=process.cwd(),out=path.join(root,'output/mygo-v17-migration-20261017/http-'+Date.now());await fs.mkdir(out,{recursive:true});
const binding=JSON.parse(await fs.readFile(path.join(root,'.local/mygo-v17-public/connection.json'),'utf8')),checks=[];
async function request(method,url,body,extra={}){const r=await fetch('http://127.0.0.1:46510'+url,{method,headers:{'X-OpsTwins-Pilot':binding.token,'content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});let data;try{data=await r.json()}catch{data={}}return {status:r.status,data}}
const ok=(name,pass,detail)=>{checks.push({name,status:pass?'PASS':'FAIL',...(detail?{detail}: {})});if(!pass)throw Error(name)};
try{
 ok('真实隔离HTTP健康',(await request('GET','/api/health')).status===200);
 const baseline=(await request('GET','/api/tasks/v17-document-task')).data;
 const updated=await request('PATCH','/api/tasks/'+baseline.id,{notes:baseline.notes+'\n\nHTTP-REVISION-END',baseUpdatedAt:baseline.updatedAt});ok('任务版本化保存',updated.status===200&&updated.data.notes.endsWith('HTTP-REVISION-END'));
 ok('旧版本拒绝覆盖',(await request('PATCH','/api/tasks/'+baseline.id,{notes:'stale',baseUpdatedAt:baseline.updatedAt})).status===409);
 await request('PATCH','/api/tasks/'+baseline.id,{notes:baseline.notes,baseUpdatedAt:updated.data.updatedAt});
 const folder=path.join(out,'public-knowledge');await fs.mkdir(folder);
 const paths=(await request('GET','/api/settings/knowledge-paths')).data;
 const row={id:'http-'+crypto.randomUUID(),path:folder};const saved=await request('PATCH','/api/settings/knowledge-paths',{version:paths.version,paths:[row]});ok('路径实际检查并保存',saved.status===200&&saved.data.paths[0].path===folder);
 ok('路径保存拒绝旧版本',(await request('PATCH','/api/settings/knowledge-paths',{version:paths.version,paths:[]})).status===409);
 for(const[name,value]of [['relative','folder/relative'],['url','https://example.com'],['missing',folder+'-missing']]){const r=await request('PATCH','/api/settings/knowledge-paths',{version:saved.data.version,paths:[{...row,path:value}]});ok('拒绝无效目录 '+name,r.status===400)}
 ok('目录规范化去重',(await request('PATCH','/api/settings/knowledge-paths',{version:saved.data.version,paths:[row,{id:'other',path:folder+'/'}]})).status===400);
 ok('通用设置不能绕过路径版本',(await request('PATCH','/api/settings',{knowledgePaths:[]})).status===400);
 const settings=(await request('GET','/api/settings')).data,changed=await request('PATCH','/api/settings',{autonomy:{holdSending:!settings.autonomy.holdSending},baseSettings:{autonomy:settings.autonomy}});ok('自主权限实际CAS保存',changed.status===200);
 ok('自主权限冲突返回409',(await request('PATCH','/api/settings',{autonomy:{holdSending:true},baseSettings:{autonomy:settings.autonomy}})).status===409);
 ok('拒绝未定义操作权限',(await request('PATCH','/api/settings',{autonomy:{permissions:{unknown:'auto'}}})).status===400);
 ok('拒绝无效操作级别',(await request('PATCH','/api/settings',{autonomy:{permissions:{tasks:'allow-anything'}}})).status===400);
 await request('PATCH','/api/settings',{autonomy:settings.autonomy,baseSettings:{autonomy:changed.data.autonomy}});
 const identity=(await request('GET','/api/settings/documents/soul')).data;ok('身份文档完整且有版本',identity.version&&typeof identity.content==='string');
 ok('文档拒绝旧版本',(await request('PATCH','/api/settings/documents/soul',{version:'stale-version',content:'DO NOT WRITE'})).status===409);
 const anonymous=await request('GET','/api/task-agents/status');ok('执行器拒绝缺失客户端标识',anonymous.status===403);
 const client=crypto.randomUUID(),headers={'x-opstwins-agent':'direct','x-opstwins-client':client};
 const auth=await request('GET','/api/task-agents/status',undefined,headers);ok('执行器实际查询原生登录',auth.status===200&&auth.data.executors?.length===2);await fs.writeFile(path.join(out,'native-auth.json'),JSON.stringify(auth.data,null,2));
 const absent=await request('GET','/api/task-agents/requests/'+crypto.randomUUID(),undefined,headers);ok('未知请求保持404',absent.status===404);
 ok('执行要求真实任务',(await request('POST','/api/task-agents/requests/'+crypto.randomUUID(),{engine:'codex',taskId:'missing-task',access:'read-only',prompt:'Reply OK'},headers)).status===404);
 const models=(await request('GET','/api/settings/models')).data;const selected=models.providers.find(p=>p.id==='standard'&&p.configured);
 if(selected){const selection={providerId:selected.id,model:selected.models[0]},switched=await request('PATCH','/api/settings/models',{version:models.version,standard:selection,deep:selection});ok('隔离模型选择与协议凭据保持渠道绑定',switched.status===200&&switched.data.standard.providerId===selection.providerId);await fs.writeFile(path.join(out,'test-model.json'),JSON.stringify({original:models.standard,testing:selection,productionConfigurationChanged:false}));}
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,scope:'actual production API, isolated public workspace; no external sends',modelInference:false},null,2));console.log({out,passed:checks.length});
}catch(e){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({checks,error:String(e)},null,2));throw e}
