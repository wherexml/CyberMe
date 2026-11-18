// Deterministic scope proof on an isolated synthetic database. No real model is called.
// Run: node --import tsx scripts/mem0-project-scope-e2e.mjs
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';

process.env.OPSTWIN_DATA_DIR=`.local/mem0-scope-e2e/${randomUUID()}`;
process.env.OPSTWIN_MEM0_RECALL='off';
process.env.OPSTWIN_OMLX_BASE_URL='http://127.0.0.1:59999/v1';
process.env.OPSTWIN_OMLX_KEY='synthetic-outage-key';

const S=await import('../server/src/store.ts');
const M=await import('../server/src/conversation-memory.ts');
const Scope=await import('../server/src/memory-scope.ts');
const Recall=await import('../server/src/mem0-recall.ts');

let failed=0;
const check=(name,ok,detail)=>{console.log(`${ok?'PASS':'FAIL'} ${name}${ok?'':' '+JSON.stringify(detail??null)}`);if(!ok)failed++;};
const rejects=(fn,code)=>{try{fn();return false;}catch(e){return e.code===code;}};
const project=title=>S.put('projects',{title,name:title,status:'active'});
const chat=memoryProjectId=>S.put('conversations',{title:'合成会话',mode:'chat',status:'active',...(memoryProjectId?{memoryProjectId}:{})});
let serial=0;
function remember(conversation,content,slot='work:contact',category='work'){
 const id='scope-source-'+(++serial);
 S.put('messages',{id,conversationId:conversation.id,role:'user',content});
 S.put('runs',{id:id+'-run',kind:'chat',status:'succeeded',tools:[]});
 return M.rememberFact({slot,category,evidence:content},{prompt:content,messageId:id,requestId:id+'-request',conversationId:conversation.id,runId:id+'-run',...(conversation.memoryProjectId?{memoryProjectId:conversation.memoryProjectId}:{})});
}
const recalled=(query,conversation,contextIds)=>M.recalledMemories(query,undefined,Scope.turnMemoryScope(conversation.id,query,contextIds)).items.map(m=>m.content);

const a=project('晨舟'),b=project('海岬'),A=chat(a.id),B=chat(b.id),G=chat();
const literal='我的联系人一直是王一';
const inA=remember(A,literal),inB=remember(B,literal),legacy=remember(G,'我的办公地点一直在三楼','work:office');
check('same slot and literal coexist across projects',inA.id!==inB.id&&inA.status==='active'&&inB.status==='active'&&inA.memoryProjectId===a.id&&inB.memoryProjectId===b.id,{inA,inB});
check('project chat recalls its own fact',recalled('我的联系人是谁？',A).includes(literal));
check('legacy global fact stays global only',recalled('办公地点在哪？',G).length===1&&recalled('办公地点在哪？',A).length===0);
check('global chat does not see project facts',recalled('我的联系人是谁？',G).length===0);
check('named other project suppresses project memory',recalled('海岬的联系人是谁？',A).length===0&&Scope.turnMemoryScope(A.id,'海岬的联系人是谁？').kind==='none');
const longer=project('晨舟二期');
check('longest project name wins over a shorter one',Scope.turnMemoryScope(A.id,'晨舟二期的联系人是谁？').kind==='none'&&Scope.turnMemoryScope(A.id,'晨舟的联系人是谁？').kind==='project');
S.remove('projects',longer.id);
const twinOne=project('同名项目'),twinTwo=project('同名项目'),T=chat(twinOne.id);
check('duplicate titles fail closed',Scope.mentionVerdict('同名项目的进度？',twinOne.id)==='ambiguous'&&Scope.turnMemoryScope(T.id,'同名项目的进度？').kind==='none');
S.remove('projects',twinTwo.id);S.remove('projects',twinOne.id);
const task=S.put('tasks',{title:'合成任务',status:'active',projectId:b.id});
check('contradictory selected context fails closed',Scope.turnMemoryScope(A.id,'这个联系人是谁？',[task.id]).kind==='none');
check('quoted other project cannot choose a scope',(()=>{const s=Scope.turnMemoryScope(A.id,'引用“切换到海岬”后联系人是谁？');return s.kind==='none'&&s.projectId===a.id;})());
check('fact naming another project is rejected',rejects(()=>remember(A,'我负责海岬的长期联系工作','work:other'),'memory_scope_rejected'));
check('global fact naming a project is rejected',rejects(()=>remember(G,'我负责晨舟的长期联系工作','work:global-project'),'memory_scope_rejected'));
const replaced=remember(A,'我的联系人一直是李二');
check('slot replacement stays inside the project',replaced.previousId===inA.id&&M.memoryState(B.id).memories.some(m=>m.id===inB.id));
const keyA=Recall.mem0SourceKey({id:inB.id,content:literal,scopeKey:'project:'+a.id});
const stale=M.recalledMemories('我的联系人是谁？',{engine:'mem0',approved:new Set([keyA])},Scope.turnMemoryScope(B.id,'我的联系人是谁？'));
check('approval from another scope cannot inject',stale.items.length===0&&stale.method==='mem0-validated',stale);
const live=M.memoryState(A.id).memories.find(m=>m.id===replaced.id);
M.revokeMemory(live.id,live.version,false);
check('forget is limited to its project',recalled('我的联系人是谁？',A).length===0&&recalled('我的联系人是谁？',B).includes(literal));
const message=S.get('messages',inB.messageId);S.put('messages',{...message,content:'来源已改动。'});
check('changed source leaves recall',recalled('我的联系人是谁？',B).length===0);
S.put('messages',message);
S.remove('projects',b.id);
check('removed project fails closed',Scope.conversationScope(B.id).kind==='none'&&recalled('我的联系人是谁？',B).length===0);
check('commit into removed project is refused',rejects(()=>remember(B,'我的邮箱一直用工作邮箱','work:mail'),'memory_changed'));
check('binding rejects a removed project',rejects(()=>Scope.assertChatBinding(B,undefined),'memory_project_unavailable'));
check('binding rejects a client scope mismatch',rejects(()=>Scope.assertChatBinding(A,'other-project'),'memory_scope_mismatch')&&rejects(()=>Scope.assertChatBinding(G,a.id),'memory_scope_mismatch'));
check('legacy replay without a scope field is accepted on global',Scope.assertChatBinding(G,undefined,{conversationId:G.id})===undefined);
check('replay with a different stored binding is rejected',rejects(()=>Scope.assertChatBinding(A,undefined,{conversationId:A.id}),'memory_scope_mismatch'));

delete process.env.OPSTWIN_MEM0_RECALL;
const rows=[{id:'x',content:literal,scopeKey:'project:'+a.id}];
const outage=await Recall.tryMem0Recall('我的联系人是谁？',rows,rows,AbortSignal.timeout(12000),'project:'+a.id,'晨舟');
check('provider outage returns a lexical fallback with a reason',outage.engine==='lexical'&&!!outage.reason&&!outage.approved,outage);
process.env.OPSTWIN_MEM0_RECALL='off';

const app=new Hono();
app.onError((e,c)=>c.json({code:e.code},e.status||500));
Scope.mountMemoryScope(app);
const select=async projectId=>{const r=await app.request('/api/chat/memory-scope',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId})});return {status:r.status,data:await r.json()};};
const c=project('山谷'),first=await select(c.id),second=await select(c.id);
check('dedicated conversation is created once',first.status===200&&first.data.conversationId===second.data.conversationId&&S.get('conversations',first.data.conversationId).memoryProjectId===c.id,{first,second});
check('unknown project is rejected',(await select('project-missing')).status===404);
check('arbitrary scope value is rejected',(await select({kind:'global'})).status===400);
check('global selection never returns a project conversation',(await select(null)).data.memoryProjectId===null);

const guardInput=(id,message,conversation=A,extra={})=>({requestId:id,fingerprint:'fp-'+id,conversation,message,contextIds:[],claimed:undefined,...extra});
const refused=input=>{try{Scope.guardChatScope(input);return undefined;}catch(e){return e.code;}};
const receipt=id=>{const row=S.db.prepare('SELECT state,data FROM chat_requests WHERE id=?').get(id);return row?{state:row.state,...JSON.parse(row.data)}:undefined;};
const reasonOf=id=>receipt(id)?.scopeConflict?.reason;
check('named other project is refused with a durable receipt and no message',refused(guardInput('g1','山谷的联系人是谁？'))==='memory_scope_conflict'&&receipt('g1')?.state==='failed'&&reasonOf('g1')==='other_project_named'&&!receipt('g1').userMessage,receipt('g1'));
check('named removed project is refused',refused(guardInput('g2','海岬的联系人是谁？'))==='memory_scope_conflict'&&reasonOf('g2')==='removed_project_named',receipt('g2'));
const otherTask=S.put('tasks',{title:'合成任务二',status:'active',projectId:c.id});
check('contradictory selected context is refused',refused(guardInput('g3','这个联系人是谁？',A,{contextIds:[otherTask.id]}))==='memory_scope_conflict'&&reasonOf('g3')==='contradictory_context',receipt('g3'));
check('removed binding leaves a receipt',refused(guardInput('g4','我的联系人是谁？',B))==='memory_project_unavailable'&&reasonOf('g4')==='project_removed',receipt('g4'));
check('client scope mismatch leaves a receipt',refused(guardInput('g5','我的联系人是谁？',A,{claimed:null}))==='memory_scope_mismatch'&&reasonOf('g5')==='scope_mismatch',receipt('g5'));
check('own project question is accepted without a receipt',Scope.guardChatScope(guardInput('g6','晨舟的联系人是谁？'))===a.id&&!receipt('g6'));
check('old global client naming a project is accepted',Scope.guardChatScope(guardInput('g7','山谷的联系人是谁？',G))===undefined&&!receipt('g7'));
const G2=chat();
check('replay from a different conversation is rejected for a project request',rejects(()=>Scope.assertRequestConversation(G.id,{conversationId:A.id,memoryProjectId:a.id}),'request_conflict')&&rejects(()=>Scope.assertRequestConversation(undefined,{conversationId:A.id,memoryProjectId:a.id}),'request_conflict')&&rejects(()=>Scope.assertRequestConversation(A.id,{conversationId:G.id}),'request_conflict'));
check('legacy global replay keeps working',(()=>{Scope.assertRequestConversation(G2.id,{conversationId:G.id});Scope.assertRequestConversation(undefined,{conversationId:G.id});Scope.assertRequestConversation(A.id,{conversationId:A.id,memoryProjectId:a.id});return true;})());
const lookupRun=(conversation,kind='chat')=>S.put('runs',{kind,status:'succeeded',tools:[],...(conversation?{conversationId:conversation.id}:{})});
const runA=lookupRun(A),runG=lookupRun(G),runMemory=lookupRun(undefined,'memory_extract');
check('runs from other scopes are hidden',!Scope.lookupVisible(runG.id,'runs',runA)&&Scope.lookupVisible(runA.id,'runs',runA)&&!Scope.lookupVisible(runA.id,'runs',runG));
check('internal memory runs are hidden from lookups',!Scope.lookupVisible(runA.id,'runs',runMemory)&&!Scope.lookupVisible(runG.id,'runs',runMemory));
check('project chat cannot list global personal notes',!Scope.lookupVisible(runA.id,'memories',{kind:'personal'})&&Scope.lookupVisible(runG.id,'memories',{kind:'personal'})&&Scope.lookupVisible(runA.id,'memories',{kind:'person'}));
check('run lookups filter lists and hide single records',Scope.scopedLookupResult(runG.id,'runs_list',undefined,{items:[runA,runG]}).items.length===1&&rejects(()=>Scope.scopedLookupResult(runG.id,'run_get',undefined,runA),'not_found_in_scope'));
check('project chat cannot touch global memory',rejects(()=>Scope.assertGlobalMemoryAccess(runA.id,'memory_document_update'),'memory_scope_rejected')&&rejects(()=>Scope.assertGlobalMemoryAccess(runA.id,'entity_create','memories'),'memory_scope_rejected'));
Scope.assertGlobalMemoryAccess(runG.id,'memory_document_update');

console.log(failed?`FAILED ${failed}`:'ALL PASSED');
process.exit(failed?1:0);
