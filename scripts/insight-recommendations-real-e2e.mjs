// Real configured model, synthetic isolated records, production HTTP + SQLite. No production records are read or changed.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
const scope=resolve('.local/acceptance/recommendation-real-'+randomUUID()),out=resolve('output/insight-actions-20261106');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const config=JSON.parse(await readFile(join(homedir(),'Library/Application Support/OpsTwins/.local/config.json'),'utf8'));
await writeFile(scope+'/config.json',JSON.stringify({llm:config.llm||config}),{mode:0o600});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_API_PORT:'46876',OPSTWIN_WEB_PORT:'46876',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts'),{categoryMetadata}=await import('../server/src/idea-category-value.ts');S.setMeta('initialized',true);S.setMeta('idea-content-topics-v3',['软件发布']);
for(const i of [{id:'checklist',title:'发布前先核对兼容性',description:'本机更新前需要保留原有草稿与任务。先整理兼容性核对清单，覆盖数据保留、草稿恢复、重启验证，再由我审阅；本轮不要安装。'},{id:'summary',title:'整理发布记录',description:'将本次窗口调整及验证结果整理成简短的 Markdown 发布记录。写明通过的项目和未覆盖的范围，只生成草稿，不发布到网站。'}])S.put('ideas',{...i,status:'new',category:'insight',contentCategory:categoryMetadata('软件发布',i)});
const before=S.list('ideas'),{app}=await import('../server/src/index.ts'),server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:46876}),checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name)};
try{
 const r=await fetch('http://127.0.0.1:46876/api/ideas/categories/refresh',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(180000)});check('real provider metadata request succeeds',r.ok);
 const after=S.list('ideas');check('both old cards gain specific recommendations',after.every(i=>i.recommendation?.label&&i.recommendation?.prompt));
 check('body, status, source, category, and timestamps preserved',after.every(i=>{const {recommendation,...rest}=i;return JSON.stringify(rest)===JSON.stringify(before.find(b=>b.id===i.id))}));
 check('no tasks or messages created',S.list('tasks').length===0&&S.list('messages').length===0);
 await writeFile(out+'/real-recommendations.json',JSON.stringify({checks,examples:after.map(i=>({title:i.title,description:i.description,recommendation:i.recommendation}))},null,2));console.log(JSON.stringify({checks,examples:after.map(i=>({label:i.recommendation.label,prompt:i.recommendation.prompt}))}));
}catch(e){await writeFile(out+'/real-recommendations.json',JSON.stringify({checks,error:e.name},null,2));console.log(JSON.stringify({checks,error:e.name}));process.exitCode=1}finally{server.close();S.db.close()}
