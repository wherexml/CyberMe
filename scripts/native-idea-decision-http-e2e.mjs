// Public-data E2E through production Hono and the configured real model.
// Failures checked: stale work called overdue, missing fresh state, raw IDs,
// overlong descriptions, duplicate output headings, and non-readable chat storage.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const scope=resolve('.local/acceptance/idea-decision-'+randomUUID());
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1'});
const {tsImport}=await import('tsx/esm/api');
const store=await tsImport('../server/src/store.ts',import.meta.url);
store.setMeta('initialized',true);
store.patchSettings({identity:{name:'公开验收用户',about:'',instructions:'仅使用公开工作区数据，不连接外部来源。',language:'zh-CN'},autonomy:{holdSending:true}},'public QA');
store.put('tasks',{id:'QA-DECISION-COMPLETED',title:'公开示例项目：旧版资料提交',status:'completed',notes:'8月31日曾等待资料；10月4日已收到并完成审核，旧催交事项结束。'});
store.put('tasks',{id:'QA-DECISION-CURRENT',title:'公开示例项目：确定试点日期',status:'active',notes:'10月4日最新状态：资料已收到，当前只需确定10月8日还是10月9日开始试点。没有外发授权。'});
const {app}=await tsImport('../server/src/index.ts',import.meta.url);
const {serve}=await import('@hono/node-server');
const server=serve({fetch:app.fetch,port:46273,hostname:'127.0.0.1'});
try {
 const response=await fetch('http://127.0.0.1:46273/api/ideas/think',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'为公开示例项目给出当前最值得决策的灵感。历史8月31日等待资料，请先查询本工作区最新任务再判断。只分析，不写任务或外发。',mode:'chat'}),signal:AbortSignal.timeout(180000)});
 const data=await response.json();const ideas=data.ideas||[];
 const content=ideas.map(i=>i.title+'\n'+i.description).join('\n');
 const checks={http:response.status===200,bounded:ideas.length>0&&ideas.length<=3,readable:typeof data.assistantMessage?.content==='string'&&!data.assistantMessage.content.trim().startsWith('{'),markdown:ideas.every(i=>i.description.includes('**下一步**')&&i.description.includes('\n- ')),concise:ideas.every(i=>[...i.description].length<=260),noRawIds:!content.includes('QA-DECISION-'),fresh:content.includes('试点'),lookedUp:(data.run?.tools||[]).some(t=>t.status==='succeeded'&&t.effect==='read')};
 const report={checks,status:response.status,ideas,assistantContent:data.assistantMessage?.content,runStatus:data.run?.status};
 await mkdir('output/idea-disclosure',{recursive:true});await writeFile('output/idea-disclosure/model-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(checks));if(Object.values(checks).some(v=>!v))process.exitCode=1;
}finally{server.close();}
