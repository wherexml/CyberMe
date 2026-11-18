// Controlled by attention-restart-http-e2e.mjs. Production HTTP + SQLite with synthetic data and a local fake model; workers stay off so every sync is explicit.
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve(process.env.ATTENTION_SCOPE||''),port=46852,modelPort=46853;
if(!scope.startsWith(resolve('.local/acceptance')+'/'))throw Error('isolated scope required');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-reminder'}}),{mode:0o600});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
const {seedApprovedInsight}=await import('./lib/approved-insight-fixture.mjs'),{visualFingerprint}=await import('../server/src/insight-visuals.ts');
// Canonical delivery state: a generated idea reaches chat/digest only with a ready reviewed visual for its exact
// version. Workers stay off here, so before each explicit sync the fixture stands in for a completed visual worker
// (shared reviewed-cache helper); delivery policy and product code are untouched. Dismissed ideas are never seeded.
const visualSeedErrors=[];
function approveVisible(){for(const idea of S.list('ideas')){if(!['new','deferred'].includes(idea.status))continue;try{const row=S.db.prepare('SELECT fingerprint,status FROM insight_visuals WHERE idea_id=?').get(idea.id);if(row?.status==='ready'&&row.fingerprint===visualFingerprint(idea))continue;seedApprovedInsight(idea)}catch(e){visualSeedErrors.push({id:idea.id,error:String(e?.message||e)})}}}
const {app}=await import('../server/src/index.ts'),B=await import('../server/src/ideas-background.ts'),IC=await import('../server/src/ideas-chat.ts'),BC=await import('../server/src/inbox-chat.ts'),D=await import('../server/src/attention-delivery.ts');
let modelResult={ideas:[],retire:[]};
const stream=(res,delta,finish)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-reminder',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
const model=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);res.writeHead(200,{'content-type':'text/event-stream'});
 if(input.tools?.some(t=>t.function?.name==='search_idea_sources')&&!input.messages.some(m=>m.role==='tool')){stream(res,{role:'assistant',tool_calls:[{index:0,id:'public-source-check',type:'function',function:{name:'search_idea_sources',arguments:JSON.stringify({query:'公开'})}}]},null);stream(res,{},'tool_calls');res.end('data: [DONE]\n\n');return}
 stream(res,{role:'assistant',content:JSON.stringify(modelResult)},null);stream(res,{},'stop');res.end('data: [DONE]\n\n')}).listen(modelPort,'127.0.0.1');
const clearAll=()=>{for(const type of ['inbox','inbox_triages','ideas','idea_history','messages','attention_ledger','attention_ops','tasks'])S.db.prepare('DELETE FROM entities WHERE type=?').run(type);S.setMeta('attention-delivery-v1',{});S.setMeta('ideas-chat-v1',{enabledAt:'2020-01-01T00:00:00Z',alerts:{},ideas:{},withdrawn:{},withdrawnAt:{}});S.setMeta('ideas-background-v1',{status:'idle',seen:{}})};
const snapshot=()=>{const chat=S.list('messages').filter(m=>m.conversationId==='main'),digests=chat.filter(m=>m.inboxAnalysis?.digest);return {reminders:chat.filter(m=>m.inboxAnalysis&&!m.inboxAnalysis.digest).map(m=>m.id),ideaMessages:chat.filter(m=>m.ideaAnalysis).map(m=>m.id),digests:digests.map(m=>({id:m.id,entries:m.inboxAnalysis.entries.map(e=>e.entityId),more:m.inboxAnalysis.more})),held:D.heldRows().length,tasks:S.list('tasks').filter(t=>t.attentionKey).length,reminderContext:!!IC.ideaReminderContext('main'),visualSeedErrors}};
const gate=new Hono();
gate.post('/fixture',async c=>{const b=await c.req.json();let value;
 if(b.reset){clearAll();S.put('conversations',{id:'main',title:'公开主对话'});S.setMeta('primaryConversationId','main')}
 if(b.settings)S.patchSettings({autonomy:b.settings});
 for(const r of b.requests||[]){const text='公开请求：请确认 '+r.id;S.put('inbox',{id:r.id,title:'公开事项 '+r.id,sender:'公开发送者 '+r.id,channel:'Public',origin:'human',status:'pending',body:text,messages:[{id:r.id+'-m1',body:text,senderName:'公开发送者 '+r.id,sentAt:new Date(Date.now()-36e5).toISOString(),isMine:false}]});S.put('inbox_triages',{id:r.id,status:'succeeded',route:'quick_reply',priority:r.priority||'medium',actionType:'reply',resolution:'open',requestMessageId:r.id+'-m1',needsReply:.9,needsOwner:.5,missingContext:0,risk:.1,reason:'direct_request',sourceVersion:S.inboxTriageVersion(S.get('inbox',r.id)),policyVersion:S.TRIAGE_POLICY_VERSION})}
 if(b.source)S.put('tasks',{...S.get('tasks',b.source.id),id:b.source.id,title:'公开资料',notes:b.source.notes,eventAt:S.now(),status:'active'});
 if(b.idea){const src=B.sources().find(x=>x.id===b.idea.sourceId);value=S.put('ideas',{id:b.idea.id,title:'公开灵感',description:'公开判断。',topicKey:S.hash(b.idea.id),status:'new',autoGenerated:true,refreshedAt:S.now(),sourceIds:[src.id],sourceFingerprints:{[src.id]:src.fingerprint},evidence:[{sourceId:src.id,quote:b.idea.quote}]})}
 if(b.modelResult)modelResult=b.modelResult;
 if(b.backdateDigest)S.setMeta('attention-delivery-v1',{lastDigestAt:new Date(Date.now()-4*36e5).toISOString()});
 // Exactly what a crash mid-action leaves behind: a recorded operation that never finished.
 if(b.runningOp){const o=b.runningOp;S.put('attention_ops',{id:o.operationId,fingerprint:S.hash([o.type,o.entityKind,o.entityId,o.requestMessageId,o.requestRevision,o.provenanceKey,o.until]),type:o.type,entityKind:o.entityKind,entityId:o.entityId,status:'running',startedAt:S.now()})}
 if(b.syncIdeas){approveVisible();IC.syncIdeasChat()}
 if(b.syncInbox)BC.syncInboxChat();
 return c.json({value,state:snapshot()})});
gate.all('/api/*',c=>app.fetch(c.req.raw));
serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
console.log(JSON.stringify({ready:true,port}));
