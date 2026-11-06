// Actual local model + isolated production HTTP. Synthetic conversations only, no sending.
import fs from 'node:fs/promises';import path from 'node:path';import {serve} from '@hono/node-server';
const root=process.env.ACK_CODE_ROOT||process.cwd(),out=path.resolve('output/acknowledgement-filter-20261106'),scope=path.join(root,'.local/ack-real-'+Date.now());await fs.mkdir(scope,{recursive:true});await fs.mkdir(out,{recursive:true});Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_INBOX_CHAT_BACKGROUND:'0'});
const history=Array.from({length:10},(_,i)=>[{text:'请确认公开演示的场地'+i,isMine:false},{text:'已确认，在公开会议室'+i,isMine:true}]).flat();
const cases=[
 {id:'okay',texts:['好的'],quiet:true},
 {id:'received',texts:['收到'],quiet:true},
 {id:'thanks',texts:['谢谢'],quiet:true},
 {id:'flower',texts:['好的[送你小红花]'],quiet:true},
 {id:'emoji',texts:['收到，谢谢🙏'],quiet:true},
 {id:'will-do',owner:'请你整理公开材料，周五交给我。',texts:['明白，我周五整理好发你'],quiet:true},
 {id:'old-history',history:true,owner:'公开材料已经发出，请查收。',texts:['好的，谢谢'],quiet:true},
 {id:'thanks-question',texts:['谢谢，请确认公开会议是周五还是周六？'],quiet:false},
 {id:'received-question',texts:['收到，不过还需要你把公开方案发给我'],quiet:false},
 {id:'okay-question',texts:['好的。你能在明天之前确认吗？'],quiet:false},
 {id:'received-goods',texts:['你收到公开样品了吗？'],quiet:false},
 {id:'question-then-thanks',texts:['请你今天确认公开会议安排在周五还是周六。','谢谢'],quiet:false},
 {id:'ellipsis-request',texts:['公开议程发我一下，谢谢'],quiet:false},
 {id:'confirmed-receipt',owner:'公开资料我已经发给你了。',texts:['资料收到了，谢谢你！'],quiet:true},
 {id:'quoted-thanks',texts:['客户只回复“好的”，但还没确认方案。请你决定我们选A还是B。'],quiet:false},
 {id:'closed-owner-commitment',closed:true,owner:'我周一会核对公开样例并发给你结论。',texts:['收到，谢谢'],quiet:false},
 {id:'owner-commitment',owner:'我明天会把公开说明整理好发给你。',texts:['好的，谢谢'],quiet:false},
];
const providerResponses=[];const f=fetch;let calls=0;globalThis.fetch=async(u,o)=>{if(String(u).includes(':48000/'))calls++;if(!/^http:\/\/127\.0\.0\.1:(46896|48000)\//.test(String(u)))throw Error('Unexpected external request');const r=await f(u,o);if(String(u).includes(':48000/')){const j=await r.clone().json();providerResponses.push({status:r.status,finishReason:j.choices?.[0]?.finish_reason,content:j.choices?.[0]?.message?.content});}return r};
const S=await import(path.join(root,'server/src/store.ts'));S.setMeta('initialized',true);const {app}=await import(path.join(root,'server/src/index.ts'));const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:46896}),clock=Date.now,checks=[];
for(const c of cases){const ms=[...(c.history?history:[]),...(c.owner?[{text:c.owner,isMine:true}]:[]),...c.texts.map(text=>({text,isMine:false}))];S.put('inbox',{id:c.id,title:'公开确认消息验收',sender:'公开同事',channel:'Feishu',sourceSystem:'public-fixture',status:c.closed?'dismissed':'pending',...(c.closed?{closedAt:new Date(clock()-120000).toISOString()}:{}),chatMode:'p2p',messages:ms.map((m,i)=>({...m,id:c.id+'-'+i,sentAt:new Date(clock()-60000+i*1000).toISOString()}))});}Date.now=()=>clock()+180001;
try{for(const c of cases.filter(c=>!process.env.ACK_CASES||process.env.ACK_CASES.split(',').includes(c.id))){const r=await fetch('http://127.0.0.1:46896/api/inbox/'+c.id+'/triage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({force:true}),signal:AbortSignal.timeout(120000)}),t=await r.json();let v=S.get('inbox',c.id);if(c.closed&&t.status==='succeeded'){const rounds=S.list('inbox').filter(x=>x.sourceParentInboxId===c.id);checks.push({case:c.id+'-single-round',pass:rounds.length===1&&rounds[0].requestRoundId===c.id+'-0'});if(rounds.length===1){Date.now=()=>clock()+360002;const rr=await fetch('http://127.0.0.1:46896/api/inbox/'+rounds[0].id+'/triage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({force:true})});const rt=await rr.json();v=S.get('inbox',rounds[0].id);checks.push({case:c.id+'-bound-round',judgmentStatus:rt.status,reason:v.attention.reason,pass:v.attention.surface==='decision'&&(rt.status==='succeeded'&&rt.requestMessageId===c.id+'-0'&&rt.actionType==='decision'||rt.status==='failed'&&v.lastOpenRequest?.requestMessageId===c.id+'-0')});}}const pass=r.ok&&t.status==='succeeded'&&(c.quiet?t.route==='no_reply'&&v.attention.surface==='none':t.resolution==='open'&&['reply','decision'].includes(t.actionType)&&v.attention.surface!=='none');checks.push({case:c.id,pass,http:r.status,status:t.status,method:t.method,route:t.route,action:t.actionType,resolution:t.resolution,reason:t.reason,surface:v.attention.surface,needsReply:t.needsReply,rawReply:t.answers?.reply?.noul});console.log(JSON.stringify(checks.at(-1)));}if(checks.some(x=>!x.pass))process.exitCode=1;
}finally{server.close();S.db.close();Date.now=clock;await fs.writeFile(out+'/'+(process.env.ACK_RESULT||'real-result.json'),JSON.stringify({scope:'actual local oMLX; synthetic HTTP conversations; no sending',calls,checks,providerResponses},null,2));console.log(JSON.stringify({calls,pass:checks.filter(x=>x.pass).length,total:checks.length}));}
