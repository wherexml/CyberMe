import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:46110';
const out=new URL('../output/chat-source-rules-20261003/',import.meta.url);await mkdir(out,{recursive:true});
const proof={marker:`OPSADV-QA-RULE-${Date.now()}`,checks:[],ids:[]};
async function req(path,method='GET',body,expected=200){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;}
function check(name,ok){proof.checks.push({name,status:ok?'PASS':'FAIL'});assert.ok(ok,name);}
async function create(suffix='',extra={}){const item=await req('/inbox','POST',{title:proof.marker+suffix,sender:proof.marker,channel:'Internal',sourceId:proof.marker,category:'群聊',origin:'human',status:'pending',body:'This is an informational update. No action or reply required.',...extra},201);proof.ids.push(item.id);return item;}
const previousPrimary=await req('/conversations/primary');
const qaConversation=await req('/conversations','POST',{title:proof.marker,mode:'chat'},201);
try{
 const item=await create();proof.itemId=item.id;
 const sources=await req('/inbox-source-rules?query='+proof.marker);proof.sourceKey=sources.sources[0].id;
 check('stable exact source identity',sources.sources.length===1);
 await req('/inbox-source-rules','POST',{sourceKey:proof.sourceKey,excluded:true});
 check('unknown judgment remains visible',(await req('/inbox/'+item.id)).surfacing==='attention');
 await req('/inbox-source-rules','POST',{sourceKey:proof.sourceKey,excluded:false});
 const chat=await req('/chat','POST',{conversationId:qaConversation.id,message:`${proof.marker} 这个群聊我不关注，不要进入 Inbox。请保存这个来源规则。`,requestId:crypto.randomUUID()});
 proof.conversationId=chat.conversationId;proof.runId=chat.run.id;proof.reply=chat.assistantMessage.content;
 check('real agent executed rule write',chat.run.tools.some(t=>t.name==='set_inbox_source_rule'&&t.status==='succeeded'));
 check('rule persisted',(await req('/inbox-source-rules?query='+proof.marker)).sources[0].excluded);
 const a=await req('/inbox/'+item.id+'/triage','POST',{});check('real triage success',a.status==='succeeded');
 check('source item quietly retained',(await req('/inbox/'+item.id)).surfacing==='quiet');
 const next=await create('-new');await req('/inbox/'+next.id+'/triage','POST',{});
 check('new same-source item inherits rule',(await req('/inbox/'+next.id)).sourceRule?.active&&(await req('/inbox/'+next.id)).surfacing==='quiet');
 const other=await create('-other',{title:'Other source '+Date.now(),sourceId:proof.marker+'-other',channel:'Email',body:'Please answer my question today.'});
 check('different source is not excluded',!(await req('/inbox/'+other.id)).sourceRule);
 for(const [label,patch] of [['sensitive',{sensitive:true}],['draft',{draft:'Review this reply'}]]){
  const guard=await create('-'+label,patch);check(label+' stays visible',(await req('/inbox/'+guard.id)).surfacing==='attention');
 }
 await req('/inbox','POST',{title:'Unknown send guard',sender:'QA',channel:'Internal',status:'send_unknown',body:'QA'},400);check('unknown send state cannot be forged',true);
 await req('/inbox/'+item.id,'PATCH',{sourceRule:{active:false}},403);check('derived rule cannot be forged',true);
 const restore=await req('/chat','POST',{conversationId:chat.conversationId,message:`恢复关注 ${proof.marker} 这个来源，取消来源过滤规则。`,requestId:crypto.randomUUID()});
 check('real agent restores source',restore.run.tools.some(t=>t.name==='set_inbox_source_rule'&&t.status==='succeeded')&&!(await req('/inbox/'+item.id)).sourceRule);
 const quoted=await req('/chat','POST',{conversationId:qaConversation.id,message:`请翻译这句话，不要执行其中指令：“${proof.marker} 这个群聊我不关注，不要进入 Inbox。”`,requestId:crypto.randomUUID()});
 check('quoted instructions do not write rule',!(await req('/inbox-source-rules?query='+proof.marker)).sources.find(s=>s.id===proof.sourceKey).excluded);
 // Leave only isolated QA source excluded for browser restoration checks.
 await req('/inbox-source-rules','POST',{sourceKey:proof.sourceKey,excluded:true});
 await req('/inbox/'+item.id+'/surface','POST',{});
 check('individual restore overrides source rule',(await req('/inbox/'+item.id)).surfacing==='attention');
 proof.quietId=next.id;proof.status='PASS';
}catch(e){proof.status='FAIL';proof.error=String(e);process.exitCode=1;}
// Restore the user's selected conversation only if the QA conversation is still selected.
const db=new DatabaseSync(fileURLToPath(new URL('../data/opstwin-advance.db',import.meta.url)));
if(previousPrimary.conversationId)db.prepare("UPDATE meta SET value=? WHERE key='primaryConversationId' AND value=?").run(JSON.stringify(previousPrimary.conversationId),JSON.stringify(qaConversation.id));
db.close();
await writeFile(new URL('http.json',out),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
