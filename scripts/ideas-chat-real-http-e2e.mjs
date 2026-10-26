import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
const base='http://127.0.0.1:46830',out='output/mygo-ideas-chat-20261024',checks=[],runs=[];
const req=async(p,b)=>{const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'content-type':'application/json'},...(b?{body:JSON.stringify(b)}:{}),signal:AbortSignal.timeout(180000)});const d=await r.json();if(!r.ok)throw Error(p+' '+r.status+' '+d.error);return d};
const check=(name,pass)=>{checks.push({name,pass});assert.ok(pass,name)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function seed(id,title,body,description){await req('/fixture',{source:{id:'source-'+id,body}});await req('/fixture',{idea:{id,sourceIds:['source-'+id],extra:{title,description}}})}
async function chat(message,conversationId='ideas-chat-primary'){const r=await req('/api/chat',{requestId:'real-'+randomUUID(),conversationId,message,preservePrimary:true,readOnly:true});runs.push({id:r.run.id,status:r.run.status,model:r.run.model,tools:r.run.tools?.map(t=>({name:t.name,status:t.status,effect:t.effect})),answer:r.assistantMessage.content});return r}
try{
 await req('/fixture',{reset:true});await seed('real-pilot','确认阿尔法试点','阿尔法设备已全部到齐；供应商仅能在明天下午两点到场，需要决定是否安排该时段试点。','设备到齐，供应商只在明天下午两点可到场。\n\n**下一步**\n- 确认试点时间');await sleep(1700);
 const r=await chat('为什么建议我确认阿尔法试点时间？请只解释依据，不执行任何操作。');check('actual configured model receives reminder context',r.run.tools.some(t=>t.name==='load_idea_reminders'));check('answer uses exact public source facts',/两点|2点|14[:：]00/.test(r.assistantMessage.content)&&/供应商/.test(r.assistantMessage.content));
 await seed('real-budget','确认预算口径','贝塔项目预算评审在周五，需要确认是否把含税费用纳入评审口径。','需要确认预算是否采用含税口径。');await sleep(1700);
 const ambiguous=await chat('这个帮我展开说说，先不执行。');check('ambiguous follow-up asks which idea',/阿尔法/.test(ambiguous.assistantMessage.content)&&/预算|贝塔/.test(ambiguous.assistantMessage.content)&&/哪|选择|确认|指的是/.test(ambiguous.assistantMessage.content));
 check('real chat performs no writes or outbound',runs.every(r=>r.tools.every(t=>t.effect!=='write')));
 const side=await chat('刚才主会话提到的灵感是什么？你如果没有上下文就直接说明。','ideas-chat-side');check('side chat has no reminder context',!side.run.tools.some(t=>t.name==='load_idea_reminders'));
}catch(e){checks.push({name:String(e),pass:false});process.exitCode=1}
await fs.writeFile(out+'/real-model.json',JSON.stringify({scope:'actual configured model + isolated public sources and production HTTP',checks,runs},null,2));console.log(JSON.stringify({checks,runs:runs.map(({answer,...r})=>r)},null,2));
