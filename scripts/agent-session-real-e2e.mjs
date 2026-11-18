// Failure cases: docs/public/agent-session.md (recorded before implementation).
// Real configured model, isolated HTTP/SQLite and synthetic sources; no production writes.
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';

const port=46916,scope=resolve('.local/acceptance/single-session-real-'+randomUUID()),out=resolve('output/agent-session-20261106/real');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const config=JSON.parse(await readFile(join(homedir(),'Library/Application Support/OpsTwins/.local/config.json'),'utf8'));
await writeFile(scope+'/config.json',JSON.stringify({llm:config.llm||config}),{mode:0o600});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开会话验收'},autonomy:{holdSending:true}});
S.put('conversations',{id:'public-alpha-conversation',title:'持续会话合成验收',sideChat:true});
S.put('conversations',{id:'public-isolated-conversation',title:'独立会话合成验收',sideChat:true});
S.put('ideas',{id:'public-alpha-idea',title:'青岚 Alpha 项目：需求拆解转 PRD',description:'公开合成资料：林澄已完成青岚 Alpha 项目的需求拆解，负责人要求他继续转成 PRD。下一步由林澄交付“待确认项”和“可开发项”两张表，逐项关联需求，并约定明确日期。验收代号 ALPHA-4826。尚未安排发送或创建任务。',status:'new'});
S.put('ideas',{id:'public-beta-idea',title:'赤石 Beta 项目：硬件到货验收',description:'公开合成资料：宋川负责赤石 Beta 的硬件到货验收，需要清点设备、核对序列号并提交验收单。验收代号 BETA-7391。',status:'new'});
const {app}=await import('../server/src/index.ts');
const api=serve({fetch:app.fetch,hostname:'127.0.0.1',port});
const checks=[],turns=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)console.error('FAIL '+name)};
const record=cid=>{const row=S.db.prepare('SELECT data FROM agent_sessions WHERE conversation_id=?').get(cid);return row?JSON.parse(row.data):null};
async function chat(message,ids=[],cid='public-alpha-conversation'){
 const body={requestId:randomUUID(),conversationId:cid,message,contextIds:ids,readOnly:true,preservePrimary:true};
 const r=await fetch(`http://127.0.0.1:${port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
 const d=await r.json();check('HTTP success turn '+(turns.length+1),r.status===200);
 if(r.status!==200)throw Error('HTTP request failed: '+r.status);
 turns.push({runId:d.run?.id,model:d.run?.model,answer:d.assistantMessage?.content,tools:d.run?.tools?.map(t=>({name:t.name,status:t.status})),session:record(cid)});
 check('no business writes turn '+turns.length,!(d.run?.tools||[]).some(t=>t.effect==='write'));
 return d.assistantMessage.content;
}
try{
 const first=await chat('你先看看吧。只分析这条事项，不做任何写入。',['public-alpha-idea']);
 check('first selected source understood',/Alpha|青岚|ALPHA-4826|林澄/.test(first)&&/PRD/.test(first));
 const original=record('public-alpha-conversation');check('durable session created',!!original?.sessionId);
 S.put('tasks',{id:'public-beta-task',title:'赤石 Beta 硬件到货验收',status:'active',notes:'最新任务，宋川清点设备并交验收单。BETA-7391。'});
 const second=await chat('你帮我看看这个任务如何处理吧。');
 check('unselected follow-up retains Alpha',/PRD/.test(second)&&/林澄|青岚|Alpha/.test(second));
 const otherMentions=second.split('\n').filter(line=>/赤石|Beta|BETA-7391|宋川/.test(line));
 check('new unrelated task does not replace referent',otherMentions.every(line=>/无关|不相关|不是当前|并非当前|不属于/.test(line)));
 check('follow-up does not ask which task',!/哪一(?:条|个|项).*任务|没有一条叫|请.*(?:任务名称|任务标题)/.test(second));
 const third=await chat('那第一步应该让谁做，交付什么？');
 check('second follow-up retains responsible person and deliverable',/林澄/.test(third)&&/PRD|待确认|可开发/.test(third));
 const continued=record('public-alpha-conversation');
 check('three turns keep same durable identity',continued.sessionId===original.sessionId);
 check('three turns do not recreate live session',continued.instances===original.instances);
 const fourth=await chat('换个话题，请分析这条新的事项。只分析，不做任何写入。',['public-beta-idea']);
 check('explicit new selection changes topic',/赤石|Beta|BETA-7391/.test(fourth)&&/宋川|设备|硬件/.test(fourth));
 check('topic change remains in original session',record('public-alpha-conversation').sessionId===original.sessionId&&record('public-alpha-conversation').instances===original.instances);
 const textual=await chat('现在换个话题：霁月 Gamma 项目由赵禾负责，交付数据迁移清单，不涉及硬件或 PRD。先给一个准备建议。');
 check('plain-text topic switch is honored',/霁月|Gamma|赵禾|迁移/.test(textual));
 const afterSwitch=await chat('这个任务第一步谁来做，交付什么？');
 check('follow-up after text-only switch keeps newest topic',/赵禾/.test(afterSwitch)&&/迁移/.test(afterSwitch)&&!/宋川|赤石|Beta|林澄|青岚|Alpha/.test(afterSwitch));
 const isolated=await chat('我们刚才在讨论哪个项目？只根据本对话回答，不读取其他资料。',[],'public-isolated-conversation');
 check('separate conversation does not inherit topic',!/青岚|赤石|霁月|Gamma|ALPHA-4826|BETA-7391|林澄|宋川|赵禾/.test(isolated));
 check('separate conversation has independent identity',record('public-isolated-conversation').sessionId!==original.sessionId);
 check('small conversations do not trigger compaction',!turns.some(t=>t.tools?.some(x=>x.name==='agent_session_compaction')));
 check('no outbound intents',S.db.prepare('SELECT count(*) n FROM send_intents').get().n===0);
 if(checks.some(c=>!c.pass))process.exitCode=1;
 console.log(JSON.stringify({pass:!process.exitCode,checks:checks.length,out}));
}catch(e){checks.push({name:e.message,pass:false});process.exitCode=1;console.error(e.message)}
finally{
 const hashes={};for(const p of ['server/src/agent.ts','server/src/agent-session.ts'])hashes[p]=createHash('sha256').update(await readFile(p)).digest('hex');
 await writeFile(out+'/result.json',JSON.stringify({scope:'real installed model configuration; isolated synthetic HTTP/SQLite; no installed-app acceptance',checks,turns,hashes},null,2));
 // The imported application owns unref'ed background timers. Close HTTP before exiting;
 // do not close SQLite while its timers can still read it during connection drain.
 await new Promise(r=>api.close(r));await rm(scope+'/config.json',{force:true});process.exit(process.exitCode||0);
}
