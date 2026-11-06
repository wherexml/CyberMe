// Production HTTP + V6 build + controlled provider for scripts/insight-visuals-browser-e2e.mjs. Synthetic data only.
// Build: node node_modules/vite/bin/vite.js build --config web/mygo.vite.config.ts --outDir ../.local/insight-visuals-web
// Run:   node --import tsx scripts/insight-visuals-browser-fixture.mjs   (web+api 46933, provider 46934)
// Fixture-only controls live under /__fixture/* and never under /api.
import {mkdir,readFile,writeFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';
import {serve} from '@hono/node-server';import {Hono} from 'hono';
const scope=resolve('.local/acceptance/insight-visuals-browser-'+randomUUID()),assets=resolve(process.env.INSIGHT_VISUALS_ASSETS||'.local/insight-visuals-web'),port=46933;
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port)});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46934/v1',apiKey:'public-fixture-key',api:'openai-completions',model:'public-visual'}}),{mode:0o600});

const b=(ref,quote)=>({ref,quote}),D=(text,status,ref,quote,extra={})=>({text,status,basis:[b(ref,quote)],...extra});
const spec=(title,summary,relation,blocks,extra={})=>({version:'insight-visual-v1',title,titleBasis:[b('I',title)],summary,summaryBasis:[b('I',summary)],relation,blocks,...extra});
// Synthetic records: [marker, title, description, evidence quotes, spec]
const RECORDS=[
 ['比较','两份开放时间说法不一致','公告写周六最晚开到18点，群里说开到16点，午休时间也不同。值班人没有写明。\n1. 发通知前先对照两份说法。',['周六最晚开到18点，中午不休息','群里说开到16点，中午休息一小时'],
  spec('两份开放时间说法不一致','公告写周六最晚开到18点，群里说开到16点，午休时间也不同。','comparison',[{type:'compare',subjects:[{name:'公告栏',icon:'file-text',tone:'blue'},{name:'群消息',icon:'chat-circle-text',tone:'amber'}],highlight:'differences',dimensions:[
   {name:'周六闭馆',cells:[D('18点','fact','E0','周六最晚开到18点',{qualifier:'最晚'}),D('16点','claim','E1','群里说开到16点')]},
   {name:'午休',cells:[D('中午不休息','fact','E0','中午不休息'),D('中午休息一小时','claim','E1','中午休息一小时')]},
   {name:'值班人',cells:[D('来源未提供','not-provided','I','值班人没有写明'),D('来源未提供','not-provided','I','值班人没有写明')]}]}])],
 ['映射','换新借阅系统等于重建名册','旧名册按读者编号汇总借阅次数，换新系统后汇总对象可能变成家庭账户。检索没有返回新系统的字段记录。\n1. 先做字段对照。',['按读者编号汇总每月借阅次数和逾期天数'],
  spec('换新借阅系统等于重建名册','旧名册按读者编号汇总借阅次数，换新系统后汇总对象可能变成家庭账户。','mapping',[{type:'mapping',from:{name:'旧名册',icon:'database'},to:{name:'新借阅系统',icon:'database'},rows:[
   {role:'汇总键',source:D('读者编号','fact','E0','按读者编号汇总'),target:D('家庭账户','claim','I','汇总对象可能变成家庭账户',{qualifier:'可能'}),match:'changed'},
   {role:'指标',source:D('每月借阅次数','fact','E0','每月借阅次数'),target:D('检索未返回字段记录','not-provided','I','检索没有返回新系统的字段记录'),match:'unknown'}]}])],
 ['依赖','花园的四件事里最底层的一件没人负责','修好主水管是底层前提，播种第一批种子、安排浇水轮班和开放周末参观都依赖它。\n1. 先修水管。',['修好主水管：东侧水龙头一直漏水，需要换阀门'],
  spec('花园的四件事里最底层的一件没人负责','播种第一批种子、安排浇水轮班和开放周末参观都依赖它。','dependencies',[{type:'dependencies',nodes:[
   {id:'pipe',label:D('修好主水管','fact','E0','修好主水管')},{id:'seed',label:D('播种第一批种子','fact','I','播种第一批种子')},{id:'water',label:D('安排浇水轮班','fact','I','安排浇水轮班')},{id:'open',label:D('开放周末参观','fact','I','开放周末参观')}],
   edges:[{from:'pipe',to:'seed',kind:'requires'},{from:'pipe',to:'water',kind:'requires'},{from:'pipe',to:'open',kind:'requires'}]}])],
 ['版式','海报这版做减法：三处一起改','对方说底部这一栏太挤了，线条太多。\n1. 先删多余分隔线、把底部合成一个色块、文字按类别对齐。',['底部这一栏太挤了'],
  spec('海报这版做减法：三处一起改','对方说底部这一栏太挤了，线条太多。','before-after',[{type:'beforeAfter',caption:'海报调整示意',before:{label:'当前',marks:[{kind:'heading'},{kind:'rule',removed:true},{kind:'text'},{kind:'rule',removed:true},{kind:'text'}],note:D('底部这一栏太挤了','quote','E0','底部这一栏太挤了')},after:{label:'建议示意',marks:[{kind:'heading',emphasis:true},{kind:'field'},{kind:'field'},{kind:'block',emphasis:true}],note:D('减线、对齐、底部色块','proposal','I','先删多余分隔线、把底部合成一个色块、文字按类别对齐')}}])],
 ['矩阵','读书会报名一句话含两个阶段','记录写着报名表已上线，提醒短信与签到核对没有记录。\n1. 分开记录。',['报名表已上线，提醒短信与签到核对'],
  spec('读书会报名一句话含两个阶段','记录写着报名表已上线，提醒短信与签到核对没有记录。','annotated-document',[{type:'document',kind:'task',source:'活动记录',lines:[D('报名表已上线，提醒短信与签到核对','fact','E0','报名表已上线，提醒短信与签到核对')],marks:[{target:'报名表已上线',note:'阶段一',status:'fact'},{target:'提醒短信与签到核对',note:'阶段二：没有记录',status:'not-provided'}]},
   {type:'matrix',columns:['结果'],rows:[{label:D('报名表','fact','E0','报名表已上线'),cells:[{state:'confirmed',basis:[b('E0','报名表已上线')]}]},{label:D('提醒与签到','fact','I','提醒短信与签到核对没有记录'),cells:[{state:'not-provided'}]}]}])],
 ['等待','送达时间要保留工作日限定','快递员说一般送到也要 3、4 天。\n1. 告知对方约 3–4 个工作日送达。',['这个寄过去一般送到也要 3、4 天'],
  spec('送达时间要保留工作日限定','快递员说一般送到也要 3、4 天。','values',[{type:'values',focus:0,items:[{label:'快递员说法',value:D('3、4 天','estimate','E0','一般送到也要 3、4 天',{qualifier:'一般'})}]},{type:'note',line:D('约 3–4 个工作日送达','proposal','I','约 3–4 个工作日送达',{qualifier:'约'})}])],
];
let held=[],holdMarker='';
const provider=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);const content=input.messages.findLast(m=>m.role==='user').content,text=typeof content==='string'?content:content.map(x=>x.text||'').join('');
 const rec=RECORDS.find(r=>text.includes('样例'+r[0]));const body=text.includes('# 独立复核协议')?JSON.stringify({verdict:'pass',checked:['labels','values','attribution','chronology','structure','cross_field'],issues:[]}):rec?JSON.stringify(rec[4]):'{}';
 const send=()=>{res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,end] of [[{role:'assistant',content:body},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public',choices:[{index:0,delta,finish_reason:end}]})+'\n\n');res.end('data: [DONE]\n\n')};
 if(holdMarker&&text.includes(holdMarker))held.push(send);else send();
});provider.listen(46934,'127.0.0.1');

const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
const {app}=await import('../server/src/index.ts'),V=await import('../server/src/insight-visuals.ts'),B=await import('../server/src/ideas-background.ts'),Val=await import('../shared/insight-visual.ts');
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});S.put('conversations',{id:'main',title:'公开主对话'});S.setMeta('primaryConversationId','main');
S.put('connections',{id:'feishu-local',name:'飞书',provider:'feishu',type:'im',status:'connected',permissions:['read']});
const at=ms=>new Date(Date.now()-ms).toISOString(),H=36e5;
for(const [marker,title,desc,quotes,sp] of RECORDS){
 const id='idea-'+RECORDS.findIndex(r=>r[0]===marker);
 S.put('inbox',{id:'src-'+id,title:'公开来源 '+marker,sender:'甲',channel:'feishu',origin:'human',status:'pending',body:quotes.join('\n'),messages:[{id:id+'-m',body:quotes.join('\n'),senderName:'甲',sentAt:at(2*H),isMine:false}]});
 const fp=B.sources().find(x=>x.id==='src-'+id).fingerprint;
 S.put('ideas',{id,title:'样例'+marker+'：'+title,description:desc,status:'new',category:'insight',autoGenerated:true,refreshedAt:at(H),occurredAt:at(2*H),sourceIds:['src-'+id],sourceFingerprints:{['src-'+id]:fp},evidence:quotes.map(q=>({sourceId:'src-'+id,quote:q}))});
 const refs=V.visualInput(S.get('ideas',id)),v=Val.validateInsightVisual({...sp,title:sp.title,titleBasis:[b('I',sp.title)]},refs);
 if(!v.valid){console.error('fixture spec invalid',marker,v.errors);process.exit(2)}
}
S.put('ideas',{id:'idea-plain',title:'没有证据的建议',description:'这条建议没有逐字证据，只显示原文。',status:'new',category:'insight',autoGenerated:true,refreshedAt:at(H)});
// one open request for the decision card
const msg=[{id:'r1',body:'周五前能否确认活动场地？',senderName:'乙',sentAt:at(H),isMine:false}];
S.put('inbox',{id:'req-1',title:'公开场地确认',sender:'乙',channel:'飞书',origin:'human',status:'pending',body:msg[0].body,messages:msg});
S.put('inbox_triages',{id:'req-1',status:'succeeded',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',requestMessageId:'r1',needsReply:.9,needsOwner:.5,missingContext:0,risk:.1,reason:'direct_request',sourceVersion:S.inboxTriageVersion(S.get('inbox','req-1')),policyVersion:S.TRIAGE_POLICY_VERSION});
// pre-generate all except the "等待" record (left pending for the async browser check)
await V.generateVisuals({ids:['idea-0','idea-1','idea-2','idea-3','idea-4']});

let slowMs=0;
const gate=new Hono();
gate.post('/__fixture/generate',async c=>{const {ids,hold}=await c.req.json();holdMarker=hold||'';void V.generateVisuals({ids}).catch(()=>{});return c.json({ok:true})});
gate.post('/__fixture/release',c=>{const n=held.length;held.splice(0).forEach(f=>f());holdMarker='';return c.json({released:n})});
gate.post('/__fixture/connection',async c=>{const {status}=await c.req.json();S.put('connections',{...S.get('connections','feishu-local'),status});return c.json({ok:true})});
gate.post('/__fixture/slow',async c=>{slowMs=(await c.req.json()).ms||0;return c.json({ok:true})});
gate.get('/__fixture/state',c=>c.json({held:held.length,status:V.visualStatus(),revision:S.revision()}));
gate.all('/api/*',async c=>{if(c.req.path==='/api/ideas/visuals'&&slowMs)await new Promise(r=>setTimeout(r,slowMs));return app.fetch(c.req.raw)});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
gate.get('*',async c=>{const path=resolve(assets,'.'+decodeURIComponent(c.req.path==='/'?'/cyberme.html':c.req.path));if(!path.startsWith(assets+'/'))return c.text('not found',404);try{return new Response(await readFile(path),{headers:{'content-type':types[extname(path)]||'application/octet-stream'}})}catch{return c.text('not found',404)}});
serve({fetch:gate.fetch,hostname:'127.0.0.1',port});console.log(JSON.stringify({ready:true,port,ready5:Object.values(V.visualProjection().items).filter(x=>x.state==='ready').length}));
