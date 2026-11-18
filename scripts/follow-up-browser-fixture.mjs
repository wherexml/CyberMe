// Isolated production-UI fixture for scripts/follow-up-browser-e2e.mjs. Spec: docs/public/follow-up.md.
// Port 46934; synthetic SQLite; no model, no source sync, no sending. The follow-up worker is OFF so the
// browser sees a stable state; every button still goes through the real task/revision-bound HTTP routes.
// Build first: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/follow-up-web
// Run: node --import tsx scripts/follow-up-browser-fixture.mjs
// Follow-up state is seeded through the server store because these fields are server-managed (HTTP
// writes are refused); this is synthetic acceptance input, not evidence of a real check.
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/follow-up-browser-'+randomUUID()),assets=resolve(process.env.FOLLOW_UP_ASSETS||'.local/follow-up-web'),port=46934;
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_VIRTUAL_IM_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',CYBERME_FOLLOWUP_WORKER:'0',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port)});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
const {app}=await import('../server/src/index.ts');
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});
S.put('conversations',{id:'main',title:'公开主对话'});S.setMeta('primaryConversationId','main');
const at=ms=>new Date(Date.now()+ms).toISOString(),H=36e5,sha=t=>createHash('sha256').update(t).digest('hex');
const auth1=S.put('messages',{id:'auth-1',conversationId:'main',role:'user',content:'帮我跟进 Bob 是否同意方案 B，下午看一次',requestId:'req-auth-1'});
const auth2=S.put('messages',{id:'auth-2',conversationId:'main',role:'user',content:'也帮我跟进 Dan 的会议材料',requestId:'req-auth-2'});
const binding=(person,personId)=>({adapter:'virtual-im',connectionId:'virtual-im-local',connectionVersion:'fixture-instance',itemId:'fx-'+personId,personId,personName:person,requestMessageId:'req-'+personId,requestSentAt:at(-2*H),group:false});
const followUp=(id,authority,extra)=>({id,state:'waiting',revision:2,conversationId:'main',authority:{messageId:authority.id,requestId:authority.requestId,evidence:authority.content.slice(0,10),via:'chat'},binding:binding('Bob','bob'),schedule:{checkAt:at(-H),cadenceMinutes:60,missedCatchUp:'once'},reviewedMessageIds:[],history:[],...extra});
// Two matters in one conversation: Bob awaits a human decision, Dan is still waiting.
S.put('tasks',{id:'fx-task-bob',title:'跟进 Bob 方案 B',status:'active',followUpCreated:true,followUp:followUp('fu-bob',auth1,{state:'needs_judgment',predicate:{kind:'judgment',objective:false,criterion:'Bob 同意方案 B'},candidate:{checkId:'chk-bob-1',messageId:'b-1',sentAt:at(-H),senderId:'bob',textHash:sha('同意，不过预算要再看')}})});
S.put('tasks',{id:'fx-task-dan',title:'跟进 Dan 会议材料',status:'active',followUpCreated:true,followUp:followUp('fu-dan',auth2,{predicate:{kind:'reply_from_person',objective:true},binding:binding('Dan','dan')})});
S.put('messages',{id:'fu-reminder-bob',conversationId:'main',role:'assistant',content:'Bob有新回复，需要你判断是否满足：Bob 同意方案 B\n> 同意，不过预算要再看',derivedKind:'follow-up-v1',taskId:'fx-task-bob',followUpId:'fu-bob',followUpRevision:2,checkId:'chk-bob-1',reminderKind:'candidate'});
const gate=new Hono();gate.all('/api/*',c=>app.fetch(c.req.raw));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
gate.get('*',async c=>{const path=resolve(assets,'.'+decodeURIComponent(c.req.path==='/'?'/cyberme.html':c.req.path));if(!path.startsWith(assets+'/'))return c.text('not found',404);try{return new Response(await readFile(path),{headers:{'content-type':types[extname(path)]||'application/octet-stream'}})}catch{return c.text('not found',404)}});
serve({fetch:gate.fetch,hostname:'127.0.0.1',port});console.log(JSON.stringify({ready:true,port,scope}));
