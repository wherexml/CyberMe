// Insight visuals: production HTTP + SQLite + controlled streaming provider. Synthetic data only; isolated ports 46931/46932.
// Run: node --import tsx scripts/insight-visuals-http-e2e.mjs   (evidence -> .local/insights-product-opus-20261106/evidence/http-e2e.json)
import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';
const scope=resolve('.local/acceptance/insight-visuals-'+randomUUID()),out=resolve(process.env.INSIGHT_VISUALS_EVIDENCE||'.local/insights-product-opus-20261106/evidence');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{CYBERME_INSIGHT_VISUALS_DAILY_CALLS:'300',OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:'46931',OPSTWIN_WEB_PORT:'46931',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const config=model=>writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46932/v1',apiKey:'public-fixture-key',api:'openai-completions',model}}),{mode:0o600});
await config('public-visual-a');

// ---- controlled provider: answers by a synthetic marker in the record title ----
const b=(ref,quote)=>({ref,quote});
const D=(text,status,ref,quote,extra={})=>({text,status,basis:[b(ref,quote)],...extra});
const good={
 '样例比较':{version:'insight-visual-v1',title:'两份折扣说法不一致',titleBasis:[b('I','两份折扣说法不一致')],summary:'甲方案与乙方案的折扣对不上，先核对。',summaryBasis:[b('I','折扣对不上')],relation:'comparison',blocks:[{type:'compare',subjects:[{name:'公告'},{name:'群消息'}],highlight:'differences',dimensions:[
  {name:'折扣',cells:[D('最多 8 折','fact','E0','甜点最多打 8 折'),D('9 折','claim','E1','群里说打 9 折')]},
  {name:'值班人',cells:[D('来源未提供','not-provided','I','值班人没有写明'),D('来源未提供','not-provided','I','值班人没有写明')]}]}]},
 '样例矩阵':{version:'insight-visual-v1',title:'报名分成两个阶段',titleBasis:[b('I','报名分成两个阶段')],summary:'报名与签到分开记录。',summaryBasis:[b('I','报名与签到分开记录')],relation:'annotated-document',blocks:[{type:'matrix',columns:['结果'],rows:[{label:D('报名表已上线','fact','E0','报名表已上线'),cells:[{state:'not-provided'}]}]}]},
};
const bad={
 hallucinated:{...good['样例比较'],title:'三份折扣说法不一致',titleBasis:[b('I','三份折扣说法不一致')]},
 recommendationAsFact:{version:'insight-visual-v1',title:'开放通知',titleBasis:[b('I','开放通知')],summary:'对外通知草稿',summaryBasis:[b('I','对外通知')],relation:'artifacts',blocks:[{type:'artifacts',groups:[{name:'通知',items:[D('周末照常开放','fact','I','周末照常开放')]}]}]},
 retrievalAbsence:{version:'insight-visual-v1',title:'没有清单',titleBasis:[b('I','检索没有返回花种清单记录')],summary:'先拿到清单再对照。',summaryBasis:[b('I','先拿到清单再对照')],relation:'quote',blocks:[{type:'note',line:D('先拿到清单再对照','proposal','I','先拿到清单再对照')}]},
 droppedWorkday:{version:'insight-visual-v1',title:'送达时间',titleBasis:[b('I','送达时间')],summary:'一般 3、4 天送达。',summaryBasis:[b('E0','一般送到也要 3、4 天')],relation:'values',blocks:[{type:'values',focus:0,items:[{label:'送达',value:D('3、4 天','estimate','E0','一般送到也要 3、4 天',{qualifier:'一般'})}]}]},
 cellWithoutBasis:{...good['样例矩阵'],blocks:[{type:'matrix',columns:['结果'],rows:[{label:D('报名表已上线','fact','E0','报名表已上线'),cells:[{state:'not-run'}]}]}]},
 markup:{...good['样例比较'],summary:'<img src=x onerror=alert(1)>'},
 negatedQuote:{version:'insight-visual-v1',title:'粉刷进度',titleBasis:[b('I','粉刷进度')],summary:'粉刷记录需要核对。',summaryBasis:[b('I','粉刷记录需要核对')],relation:'quote',blocks:[{type:'quote',line:D('粉刷已完成','quote','E0','粉刷尚未完成')}]},
 confirmedTick:{version:'insight-visual-v1',title:'粉刷进度',titleBasis:[b('I','粉刷进度')],summary:'粉刷记录需要核对。',summaryBasis:[b('I','粉刷记录需要核对')],relation:'annotated-document',blocks:[{type:'matrix',columns:['结果'],rows:[{label:D('粉刷','fact','E0','粉刷尚未完成'),cells:[{state:'confirmed',basis:[b('E0','粉刷尚未完成')]}]}]}]},
 mappingSame:{version:'insight-visual-v1',title:'名册对照',titleBasis:[b('I','名册对照')],summary:'编号方式会变化。',summaryBasis:[b('I','编号方式会变化')],relation:'mapping',blocks:[{type:'mapping',from:{name:'旧名册'},to:{name:'新名册'},rows:[{source:D('会员编号','fact','E0','按会员编号汇总'),target:D('家庭','claim','I','家庭'),match:'same'}]}]},
 malformed:{version:'insight-visual-v1',title:'名册对照',titleBasis:[b('I','名册对照')],summary:'编号方式会变化。',summaryBasis:[b('I','编号方式会变化')],relation:'dependencies',blocks:[{type:'dependencies',nodes:[null,{id:'a'}],edges:{}},{type:'matrix',columns:['x'],rows:[null]},{type:'split',relation:'and',left:{type:'split',relation:'and',left:{type:'split'},right:null},right:{}}]},
 unsupportedBlock:{...good['样例比较'],blocks:[{type:'chart',items:[{label:'a',value:1}]}]},
 missingDimension:{version:'insight-visual-v1',title:'四列准备表',titleBasis:[b('I','四列准备表')],summary:'按表准备摊位。',summaryBasis:[b('I','按表准备摊位')],relation:'artifacts',blocks:[{type:'artifacts',groups:[{name:'四列',items:[D('摊位名','proposal','I','摊位名'),D('主题','proposal','I','主题')]}]}]},
};
let calls=0,mode={},held=[];const seen=[];
const provider=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);calls++;
 const content=input.messages.findLast(m=>m.role==='user').content,text=typeof content==='string'?content:content.map(x=>x.text||'').join('');
 const key=Object.keys(mode).find(k=>text.includes(k));const repair=text.includes('上一次输出未通过校验')||text.includes('上一次输出有以下问题')||text.includes('上一次输出不是合法的 JSON');seen.push({key,repair,tools:input.tools?.length||0,model:input.model,responseFormat:input.response_format?.type,thinking:input.thinking?.type,effort:input.reasoning_effort});
 const m=mode[key]||{};
 const status=repair&&m.repairStatus?m.repairStatus:m.status;
 if(status){res.writeHead(status,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:status===429?'Rate limit / quota exceeded':'upstream error'}}))}
 const review=text.includes('# 独立复核协议');const spec=review?{verdict:'pass',checked:['labels','values','attribution','chronology','structure','cross_field'],issues:[]}:repair&&m.repair?m.repair:m.first;const body=typeof spec==='string'?spec:JSON.stringify(spec);
 const send=()=>{res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,end] of [[{role:'assistant',content:body},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public',choices:[{index:0,delta,finish_reason:end}]})+'\n\n');res.end('data: [DONE]\n\n')};
 if(m.hold&&!review)held.push(send);else send();
});provider.listen(46932,'127.0.0.1');

const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});
const {app}=await import('../server/src/index.ts');const V=await import('../server/src/insight-visuals.ts');const B=await import('../server/src/ideas-background.ts');
const call=async(method,path,body)=>{const r=await app.fetch(new Request('http://127.0.0.1:46931'+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));return {http:r.status,...(await r.json().catch(()=>({})))}};
S.put('connections',{id:'feishu-local',name:'飞书',provider:'feishu',type:'im',status:'connected',permissions:['read']});
const source=(id,body)=>S.put('inbox',{id,title:'公开来源 '+id,sender:'甲',channel:'feishu',origin:'human',status:'pending',body,messages:[{id:id+'-m',body,senderName:'甲',sentAt:'2026-11-05T08:00:00Z',isMine:false}]});
function idea(id,title,description,quotes){
 source('src-'+id,quotes.join('\n'));
 const fp=B.sources().find(x=>x.id==='src-'+id).fingerprint;
 return S.put('ideas',{id,title,description,status:'new',category:'insight',autoGenerated:true,refreshedAt:'2026-11-05T09:00:00Z',occurredAt:'2026-11-05T08:00:00Z',sourceIds:['src-'+id],sourceFingerprints:{['src-'+id]:fp},evidence:quotes.map(q=>({sourceId:'src-'+id,quote:q}))});
}
const checks=[];const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)console.error('FAIL',name,JSON.stringify(detail??''))};
const item=async id=>(await call('GET','/api/ideas/visuals')).items[id];
const row=id=>S.db.prepare('SELECT data FROM insight_visuals WHERE idea_id=?').get(id)&&JSON.parse(S.db.prepare('SELECT data FROM insight_visuals WHERE idea_id=?').get(id).data);
try{
 idea('cmp','样例比较：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。\n1. 先核对两份说法。',['甜点最多打 8 折','群里说打 9 折']);
 idea('mtx','样例矩阵：报名分成两个阶段','记录写着报名表已上线，提醒与签到没有记录。报名与签到分开记录。\n1. 分开记录。',['报名表已上线，提醒与签到核对']);
 mode={'样例比较':{first:good['样例比较']},'样例矩阵':{first:'not json at all',repair:good['样例矩阵']}};
 const ideaBefore=JSON.stringify(S.get('ideas','cmp'));

 // V14: reads never generate
 const c0=calls;await call('GET','/api/ideas/visuals');await call('GET','/api/bootstrap');await call('GET','/api/ideas/visuals/status');
 check('GET visuals/bootstrap/status make no model call',calls===c0,{calls:calls-c0});
 check('uncached item is pending, not fabricated',(await item('cmp'))?.state==='pending');

 // generation, cache hit, one repair
 let r=await call('POST','/api/ideas/visuals/generate',{ids:['cmp','mtx']});
 check('explicit generation returns ready for valid spec',r.results?.cmp==='ready',r.results);
 check('invalid JSON gets exactly one repair then ready',r.results?.mtx==='ready'&&row('mtx').calls===3,row('mtx'));
 check('model calls are tool-less',seen.every(x=>x.tools===0),seen);
 const ready=await item('cmp');check('ready projection carries validated spec',ready?.state==='ready'&&ready.spec?.relation==='comparison');
 const c1=calls;r=await call('POST','/api/ideas/visuals/generate',{ids:['cmp']});
 check('cache hit: same fingerprint makes no new call',calls===c1&&r.results.cmp==='ready');
 check('idea record untouched by generation',JSON.stringify(S.get('ideas','cmp'))===ideaBefore);
 const runs=S.list('runs').filter(x=>x.kind==='insight_visual');check('runs recorded as read-only insight_visual',runs.length===calls&&runs.every(x=>x.readOnly===true),runs.length);

 // V1/V2/V3/V5/V6/V7/V9 rejections -> fallback after at most one repair
 const rejects=[
  ['hallucinated title number/claim','hal','样例幻觉：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折'],bad.hallucinated],
  ['recommendation shown as fact','rec','样例建议：开放通知','对外通知需要统一。\n1. 一句话通知：周末照常开放。',['门口贴了临时告示'],bad.recommendationAsFact],
  ['retrieval absence shown as nonexistence','abs','样例检索：检索没有返回花种清单记录','检索没有返回花种清单记录。先拿到清单再对照。\n1. 先拿到清单再对照。',['改用社区共享花种'],bad.retrievalAbsence],
  ['workday qualifier dropped','wd','样例送达：送达时间','快递员说一般送到也要 3、4 天。\n1. 告知对方约 3–4 个工作日送达。',['这个寄过去一般送到也要 3、4 天'],bad.droppedWorkday],
  ['cell state without its own evidence','cel','样例格子：报名分成两个阶段','记录写着报名表已上线，提醒与签到没有记录。报名与签到分开记录。',['报名表已上线，提醒与签到核对'],bad.cellWithoutBasis],
  ['markup in visible text','mku','样例标记：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折'],bad.markup],
  ['unsupported component','uns','样例组件：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折'],bad.unsupportedBlock],
  ['required dimensions dropped','dim','样例维度：四列准备表','按表准备摊位。\n1. 一页表四列：摊位名、对应主题、状态、能否试吃。',['周六要看摊位安排'],bad.missingDimension],
  ['quote text changed meaning (尚未→已)','neg','样例否定：粉刷进度','粉刷记录需要核对。',['粉刷尚未完成'],bad.negatedQuote],
  ['confirmed tick from a negated basis','tck','样例勾选：粉刷进度','粉刷记录需要核对。',['粉刷尚未完成'],bad.confirmedTick],
  ['mapping same on unequal values','map','样例映射：名册对照','编号方式会变化，可能变成家庭。',['按会员编号汇总'],bad.mappingSame],
  ['malformed structure returns invalid, no crash','mal','样例畸形：名册对照','编号方式会变化。',['按会员编号汇总'],bad.malformed],
 ];
 for(const [name,id,title,desc,quotes,spec] of rejects){idea(id,title,desc,quotes);mode[title.split('：')[0]]={first:spec,repair:spec}}
 const before=calls;r=await call('POST','/api/ideas/visuals/generate',{ids:rejects.slice(0,6).map(x=>x[1])});
 const r2=await call('POST','/api/ideas/visuals/generate',{ids:rejects.slice(6).map(x=>x[1])});const all={...r.results,...r2.results};
 if(!r2.results)checks.push({name:'second reject batch accepted',pass:false,detail:r2});
 // Graph-only contract: model headers are discarded; exact quote hydration must restore the negation.
 const safelyCompiled=new Set(['hal','mku','neg']);
 for(const [name,id] of rejects){const rw=row(id),accepted=safelyCompiled.has(id);check((accepted?'safely compiled: ':'rejected: ')+name,accepted?all[id]==='ready'&&rw.calls===2&&!('title' in rw.spec)&&!('summary' in rw.spec):all[id]==='invalid'&&rw.calls===2&&(await item(id)).state==='fallback',{status:all[id],errors:rw?.errors?.slice(0,3)})}
 check('negated quote hydration displays the actual source meaning',row('neg')?.spec?.blocks[0]?.line?.text==='粉刷尚未完成');
 check('valid graphs need generation plus review; structural failures have at most one repair',calls-before===rejects.length*2,calls-before);
 const c2=calls;await call('POST','/api/ideas/visuals/generate',{ids:['rec'],retry:true});
 check('attempt limit: invalid record is not regenerated again',calls===c2&&row('rec').attempts===1);

 // F1–F4 pre-registered compiler/provider failure cases through production HTTP, no direct unit tests.
 const cg=structuredClone(good['样例比较']);delete cg.title;delete cg.titleBasis;delete cg.summary;delete cg.summaryBasis;
 const brokenNote={type:'note',line:D('99个','fact','E0','甜点最多打 8 折')};
 const compilerCases=[
  ['metadata',{...cg,relation:'before-after',blocks:[...cg.blocks,{type:'claims',items:[{claim:D('群里说打9折','claim','E1','群里说打 9 折')}]}]},null,'full'],
  ['alias',{...cg,relation:'compare',blocks:cg.blocks.map(x=>({...x,type:'comparison'}))},null,'full'],
  ['partial',{...cg,blocks:[...cg.blocks,brokenNote]},{...cg,blocks:[...cg.blocks,brokenNote]},'reduced'],
  ['worse',{...cg,blocks:[...cg.blocks,brokenNote]},'not json','reduced'],
  ['repairdown',{...cg,blocks:[...cg.blocks,brokenNote]},null,'reduced'],
  ['repairquota',{...cg,blocks:[...cg.blocks,brokenNote]},null,'reduced'],
  ['fenced','```json\n'+JSON.stringify(cg)+'\n```',null,'full'],
 ];
 for(const [id,first,repair,expected]of compilerCases){
  idea(id,'样例编译'+id+'：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);
  mode['样例编译'+id]={first,repair,...(id==='repairdown'?{repairStatus:500}:id==='repairquota'?{repairStatus:429}:{})};
  const rr=await call('POST','/api/ideas/visuals/generate',{ids:[id]}),rw=row(id),publicItem=await item(id);
  check('compiler '+id+': valid graph retained with accurate coverage',rr.results?.[id]==='ready'&&rw?.quality?.mode===expected&&rw?.quality?.informative===true,{status:rr.results?.[id],mode:rw?.quality?.mode});
  if(id==='repairquota'){check('verified reduced first candidate needs no repair call',!row(id)?.repairError&&row(id)?.calls===2);S.setMeta('insight-visuals-v1',{...S.meta('insight-visuals-v1',{}),quotaUntil:null})}
  check('compiler '+id+': diagnostics/raw remain private',!JSON.stringify(publicItem).includes('quote_hydrated')&&!publicItem.raw&&!publicItem.errors&&!publicItem.quality);
 }
 // A malformed primary relation cannot be rescued by an optional decorative quote.
 idea('primary','样例主图：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);
 mode['样例主图']={first:{...cg,blocks:[{...cg.blocks[0],dimensions:[{name:'折扣',cells:[cg.blocks[0].dimensions[0].cells[0]]}]},{type:'quote',line:D('群里说打 9 折','quote','E1','群里说打 9 折')}]}};
 const pr=await call('POST','/api/ideas/visuals/generate',{ids:['primary']});check('invalid primary dimensions cannot become a quote-only success',pr.results?.primary==='invalid'&&(await item('primary')).state==='fallback');
 // F8–F10: diagram shape and decoration must not create an unsupported statement.
 const semanticCases=[
 ['layoutMisuse',{version:'insight-visual-v1',relation:'before-after',blocks:[{type:'beforeAfter',caption:'折扣前后示意',before:{label:'之前',marks:[{kind:'heading'},{kind:'text'}],note:D('最多8折','fact','E0','甜点最多打 8 折')},after:{label:'之后',marks:[{kind:'heading'},{kind:'text'}],note:D('9折','claim','E1','群里说打 9 折')}}]},false],
 ['inventedDate',{...cg,blocks:cg.blocks.map(x=>({...x,subjects:[{name:'11-06之前'},{name:'11-06之后'}]}))},false],
 ['neutralMapping',{version:'insight-visual-v1',relation:'mapping',blocks:[{type:'mapping',from:{name:'公告'},to:{name:'群消息'},rows:[{source:D('最多8折','fact','E0','甜点最多打 8 折'),target:D('9折','claim','E1','群里说打 9 折'),match:'corresponds'}]}]},true],
 ];
 for(const[id,sp,ok]of semanticCases){idea(id,'样例图义'+id,'公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);mode['样例图义'+id]={first:sp};const rr=await call('POST','/api/ideas/visuals/generate',{ids:[id]});check('semantic guard '+id,rr.results?.[id]===(ok?'ready':'invalid'),{state:rr.results?.[id],errors:row(id)?.errors});}
 // V17 insufficient evidence: no call
 S.put('ideas',{id:'noev',title:'样例无证据',description:'没有证据的建议。',status:'new',category:'insight',autoGenerated:true});
 const c3=calls;r=await call('POST','/api/ideas/visuals/generate',{ids:['noev']});
 check('no evidence: fallback without model call',calls===c3&&(await item('noev')).state==='fallback'&&r.results.noev==='unavailable');

 // V10 late result: source edited while the call is in flight
 idea('late','样例迟到：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);
 mode['样例迟到']={first:{...good['样例比较']},hold:true};
 const pending=call('POST','/api/ideas/visuals/generate',{ids:['late']});
 for(let i=0;i<100&&!held.length;i++)await new Promise(r=>setTimeout(r,30));
 const cur=S.get('ideas','late');S.put('ideas',{...cur,description:cur.description+'（已更新）'});
 held.splice(0).forEach(f=>f());r=await pending;
 check('late result after source edit is discarded',r.results.late==='discarded'&&(await item('late')).state==='pending',r.results);

 // stale cache denied after edit; V11 revoked access
 const c=S.get('ideas','cmp');S.put('ideas',{...c,description:c.description+' 补充。'});
 check('edited record: cached visual no longer returned',(await item('cmp')).state==='pending');
 S.put('ideas',c);check('original text again: cache valid again',(await item('cmp')).state==='ready');
 S.put('connections',{...S.get('connections','feishu-local'),status:'disconnected'});
 check('revoked connection: visual withheld (unavailable)',(await item('cmp')).state==='unavailable'&&(await item('mtx')).state==='unavailable');
 const c4=calls;r=await call('POST','/api/ideas/visuals/generate',{ids:['cmp']});check('revoked: no generation',calls===c4&&r.results.cmp!=='ready'||calls===c4,r.results);
 S.put('connections',{...S.get('connections','feishu-local'),status:'connected'});check('restored connection: visual back',(await item('cmp')).state==='ready');
 S.remove('inbox','src-mtx');check('deleted source: visual withheld',(await item('mtx')).state==='unavailable');

 // R1: the source message is edited or recalled while the idea record stays the same
 idea('srcedit','样例源改：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);mode['样例源改']={first:good['样例比较']};
 await call('POST','/api/ideas/visuals/generate',{ids:['srcedit']});check('source-edit fixture ready first',(await item('srcedit')).state==='ready');
 const ideaSnap=JSON.stringify(S.get('ideas','srcedit')),src=S.get('inbox','src-srcedit');
 S.put('inbox',{...src,messages:src.messages.map(m=>({...m,body:'最高覆盖30%费用\n群里说打 9 折'})),body:'最高覆盖30%费用'});
 check('source message edited, idea unchanged: old visual withheld',JSON.stringify(S.get('ideas','srcedit'))===ideaSnap&&(await item('srcedit')).state==='fallback');
 const c7=calls;await call('POST','/api/ideas/visuals/generate',{ids:['srcedit']});check('stale evidence: no regeneration from stale quotes',calls===c7);
 S.put('inbox',{...src,messages:src.messages.map(m=>({...m,recalled:true}))});
 check('source message recalled: visual withheld',(await item('srcedit')).state!=='ready');
 S.put('inbox',src);check('source restored: cached visual valid again',(await item('srcedit')).state==='ready');
 S.put('inbox',{...src,messages:[...src.messages,{id:'srcedit-later',body:'另一件无关的新消息',senderName:'乙',sentAt:'2026-11-05T10:00:00Z',isMine:false}]});
 const c9=calls;await call('POST','/api/ideas/visuals/generate',{ids:['srcedit']});
 check('R7 unrelated new message in the same source keeps the cached visual (no regeneration)',(await item('srcedit')).state==='ready'&&calls===c9);
 S.put('inbox',{...src,messages:[...src.messages,{id:'srcedit-dup',body:'转发：甜点最多打 8 折',senderName:'乙',sentAt:'2026-11-05T10:05:00Z',isMine:false}]});
 check('R7 ambiguous quote (now in two messages, no messageId) fails closed',(await item('srcedit')).state!=='ready');
 S.put('inbox',{...src,messages:src.messages.map(m=>({...m,deleted:true}))});
 check('R7 cited message deleted: visual withheld',(await item('srcedit')).state!=='ready');
 S.put('inbox',src);check('R7 cited message back: visual valid',(await item('srcedit')).state==='ready');
 // sole cited message recalled while the copied record body still contains the old quote
 S.put('inbox',{...src,body:src.body,messages:src.messages.map(m=>({...m,recalled:true}))});
 check('anchor: sole message recalled, stale record body retained -> withheld',(await item('srcedit')).state!=='ready'&&S.get('inbox','src-srcedit').body.includes('甜点最多打 8 折'));
 S.put('inbox',{...src,messages:src.messages.map(m=>({...m,senderName:'丙'}))});
 check('anchor: sender re-attributed -> cached visual not reused',(await item('srcedit')).state!=='ready');
 S.put('inbox',src);check('anchor: original restored -> valid',(await item('srcedit')).state==='ready');
 // message stored with text instead of body
 S.put('inbox',{id:'src-txt',title:'公开来源 txt',sender:'甲',channel:'feishu',origin:'human',status:'pending',messages:[{id:'txt-m',text:'甜点最多打 8 折\n群里说打 9 折',senderName:'甲',sentAt:'2026-11-05T08:00:00Z',isMine:false}]});
 S.put('ideas',{id:'txt',title:'样例文本：两份折扣说法不一致',description:'公告与群消息的折扣对不上，值班人没有写明。',status:'new',category:'insight',autoGenerated:true,refreshedAt:'2026-11-05T09:00:00Z',sourceIds:['src-txt'],sourceFingerprints:{},evidence:[{sourceId:'src-txt',quote:'甜点最多打 8 折',messageId:'txt-m'},{sourceId:'src-txt',quote:'群里说打 9 折',messageId:'txt-m'}]});
 mode['样例文本']={first:good['样例比较']};const rt=await call('POST','/api/ideas/visuals/generate',{ids:['txt']});
 check('anchor: text-only message with exact messageId is usable',rt.results?.txt==='ready'&&(await item('txt')).state==='ready',rt.results);
 idea('lsrc','样例源迟：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);mode['样例源迟']={first:good['样例比较'],hold:true};
 const lp=call('POST','/api/ideas/visuals/generate',{ids:['lsrc']});for(let i=0;i<100&&!held.length;i++)await new Promise(r=>setTimeout(r,30));
 const ls=S.get('inbox','src-lsrc');S.put('inbox',{...ls,messages:ls.messages.map(m=>({...m,body:m.body+' 修订'}))});held.splice(0).forEach(f=>f());
 check('late result after source-message edit is discarded',(await lp).results?.lsrc==='discarded');
 // R4: concurrent explicit requests share one bounded queue and dedupe running ids
 for(let i=0;i<14;i++)idea('q'+i,'样例队列'+i+'：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);
 mode['样例队列']={first:good['样例比较'],hold:true};
 const q1=call('POST','/api/ideas/visuals/generate',{ids:['q0','q1','q2','q3','q4','q5']}),q2=call('POST','/api/ideas/visuals/generate',{ids:['q0','q6','q7','q8','q9','q10']});
 for(let i=0;i<100&&!held.length;i++)await new Promise(r=>setTimeout(r,30));
 const midRow=row('q0');check('in-flight call count is persisted before the model returns',midRow?.status==='running'&&midRow.calls===1,midRow);
 const qs=await call('GET','/api/ideas/visuals/status');
 // q3 must be rejected atomically; if it were accepted, the pump below still releases held responses (no deadlock).
 let pump;const q3p=call('POST','/api/ideas/visuals/generate',{ids:['q11','q12','q13']});
 const early=await Promise.race([q3p,new Promise(r=>setTimeout(()=>r(null),2000))]);
 pump=setInterval(()=>held.splice(0).forEach(f=>f()),20);const q3=early||await q3p;
 check('global queue is bounded and dedupes ids across requests',qs.queued<=qs.queueMax&&qs.queueMax===12&&qs.queued===10,{queued:qs.queued});
 check('overflowing request rejected atomically (nothing queued)',q3.http===429&&!row('q11')&&!row('q12'),{http:q3.http});
 await Promise.all([q1,q2]);clearInterval(pump);mode['样例队列'].hold=false;
 check('q0 generated once despite being requested twice',row('q0').calls===2&&row('q0').status==='ready');
 // V13 quota: no repair, status records it, background pauses
 idea('quo','样例额度：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);mode['样例额度']={status:429};
 idea('quo2','样例排队：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);mode['样例排队']={first:good['样例比较']};
 const c5=calls;r=await call('POST','/api/ideas/visuals/generate',{ids:['quo','quo2']});
 check('quota error pauses the queued item behind it (no call)',r.results.quo2==='paused'&&!row('quo2'),r.results);
 check('quota failure: one call, no repair, failed=quota',calls-c5===1&&row('quo').status==='failed'&&row('quo').error==='quota',row('quo'));
 const st=await call('GET','/api/ideas/visuals/status');check('quota pauses background (quotaUntil set)',!!st.quotaUntil&&Date.parse(st.quotaUntil)>Date.now(),st.quotaUntil);
 check('quota: card falls back to saved text',(await item('quo')).state==='fallback');
 const c8=calls;const qx=await call('POST','/api/ideas/visuals/generate',{ids:['cmp'],retry:true});check('quota pause also blocks explicit retries',qx.http===429&&calls===c8,qx.http);
 S.setMeta('insight-visuals-v1',{...S.meta('insight-visuals-v1',{}),quotaUntil:null});

 // F11 official same-provider JSON transport, observed through the production HTTP path.
 const savedFetch=globalThis.fetch;const transportHits=[];
 globalThis.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;const u=new URL(url);if(u.hostname==='api.deepseek.com'){transportHits.push({path:u.pathname});return savedFetch('http://127.0.0.1:46932'+u.pathname,init)}return savedFetch(input,init)};
 try{await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'https://api.deepseek.com/anthropic',apiKey:'public-fixture-key',api:'anthropic-messages',model:'deepseek-flash',modelOptions:{reasoning:true}}}));
  idea('jsonmode','样例JSON通道：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);mode['样例JSON通道']={first:good['样例比较']};
  const rr=await call('POST','/api/ideas/visuals/generate',{ids:['jsonmode']}),request=seen.findLast(x=>x.key==='样例JSON通道');const run=S.get('runs',row('jsonmode')?.runIds?.[0]);
  check('official DeepSeek insight request uses same model with JSON mode',rr.results?.jsonmode==='ready'&&request?.model==='deepseek-flash'&&request?.responseFormat==='json_object'&&request?.tools===0&&transportHits.every(x=>x.path==='/chat/completions')&&transportHits.length===2,{status:rr.results?.jsonmode,request,transportHits});
  check('configured reasoning model sends enabled high thinking for generation and review',seen.filter(x=>x.key==='样例JSON通道').every(x=>x.thinking==='enabled'&&x.effort==='high')&&run?.thinkingLevel==='high'&&run.events.some(e=>e.type==='provider_request'&&e.emittedThinking==='enabled'&&e.reasoningEffort==='high'&&e.providerTimeoutMs===90000),request);
  await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'https://api.deepseek.com',apiKey:'public-fixture-key',api:'openai-completions',model:'deepseek-flash',modelOptions:{reasoning:true}}}));mode['Reply with exactly OK.']={first:'OK'};const probe=await call('POST','/api/settings/models/test',{role:'standard',version:(await call('GET','/api/settings/models')).version});const probeRequest=seen.findLast(x=>x.key==='Reply with exactly OK.');check('non-visual model probe retains thinking off',probe.http===200&&probeRequest?.thinking==='disabled',probeRequest);
  await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'https://api.deepseek.com/anthropic',apiKey:'public-fixture-key',api:'anthropic-messages',model:'deepseek-flash',modelOptions:{reasoning:true}}}));
  check('effective transport is recorded while saved config remains Anthropic',run?.protocol==='openai-completions'&&(await import('../server/src/agent.ts')).llmConfig()?.api==='anthropic-messages',{protocol:run?.protocol});
 }finally{globalThis.fetch=savedFetch;await config('public-visual-a')}
 // F12 unknown values must stay generic and cannot smuggle factual or numeric statements without evidence.
 for(const[id,text,expected]of[['unknown','未提供','ready'],['badunknown','已完成','invalid'],['zerounknown','0','invalid']]){
  idea('empty'+id,'样例空值'+id+'：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);const sp=structuredClone(cg);sp.blocks[0].dimensions[1].cells=[{text,status:'not-provided'},{text,status:'not-provided'}];mode['样例空值'+id]={first:sp};
  const rr=await call('POST','/api/ideas/visuals/generate',{ids:['empty'+id]});check('empty basis '+id,rr.results?.['empty'+id]===expected,{status:rr.results?.['empty'+id]});
 }
 // V12 model identity change invalidates
 await config('public-visual-b');check('model change: cached visual invalidated',(await item('cmp')).state==='pending');
 await config('public-visual-a');check('model restored: cache valid again',(await item('cmp')).state==='ready');

 // V15 restart: in-flight row becomes interrupted; bounded explicit batch
 S.db.prepare("UPDATE insight_visuals SET status='running',data=json_set(data,'$.status','running') WHERE idea_id='late'").run();
 const timer=V.startInsightVisuals({pollMs:3600000});clearInterval(timer);
 check('restart marks in-flight generation interrupted',row('late').status==='interrupted');
 for(let i=0;i<9;i++)idea('bulk'+i,'样例批量'+i+'：两份折扣说法不一致','公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);
 mode['样例批量']={first:good['样例比较']};
 const c6=calls;r=await call('POST','/api/ideas/visuals/generate',{});
 check('backfill request is bounded (≤6 records)',Object.keys(r.results).length<=6&&calls-c6<=30,{n:Object.keys(r.results).length,calls:calls-c6});
 const tooMany=await call('POST','/api/ideas/visuals/generate',{ids:Array.from({length:7},(_,i)=>'x'+i)});check('more than 6 explicit ids rejected',tooMany.http===400);

 // activation gate: background backfill is off by default, on only with CYBERME_INSIGHT_VISUALS=1
 const pendingBefore=Object.values((await call('GET','/api/ideas/visuals')).items).filter(x=>x.state==='pending').length;
 delete process.env.CYBERME_INSIGHT_VISUALS;const cOff=calls;let tm=V.startInsightVisuals({pollMs:40});await new Promise(r=>setTimeout(r,400));clearInterval(tm);
 check('background backfill is OFF by default (no calls with pending items)',pendingBefore>0&&calls===cOff,{pendingBefore,calls:calls-cOff});
 const waitFor=async(predicate)=>{for(let i=0;i<250;i++){if(predicate())return true;await new Promise(r=>setTimeout(r,20))}return false};
 process.env.CYBERME_INSIGHT_VISUALS='1';const cOn=calls;tm=V.startInsightVisuals({pollMs:40});await waitFor(()=>calls>cOn);clearInterval(tm);delete process.env.CYBERME_INSIGHT_VISUALS;
 check('CYBERME_INSIGHT_VISUALS=1 enables bounded background generation',await waitFor(()=>!V.visualStatus().running)&&calls>cOn&&calls-cOn<=10,{calls:calls-cOn});
 // A late arrival can overtake old backfill without interrupting its in-flight review.
 const readyFingerprint=row('cmp').fingerprint;
 for(const existing of S.list('ideas'))S.put('ideas',{...existing,status:'archived'});
 S.setMeta('insight-visuals-budget-v1',{day:new Date().toISOString().slice(0,10),calls:999});
 const day=86400000,at=offset=>new Date(Date.now()+offset).toISOString();
 function schedulingIdea(id,patch={},model={},evidenceAt=at(-5*day)){
  const key='调度样例 '+id+'。';
  const base=idea(id,key,'公告与群消息的折扣对不上，值班人没有写明。',['甜点最多打 8 折','群里说打 9 折']);
  const src=S.get('inbox',base.sourceIds[0]);
  S.put('inbox',{...src,messages:src.messages.map(m=>({...m,sentAt:evidenceAt}))});
  mode[key]={first:good['样例比较'],...model};
  return S.put('ideas',{...base,createdAt:at(-5*day),occurredAt:at(-5*day),refreshedAt:at(-5*day),...patch,evidence:base.evidence.map(e=>({...e,messageId:src.messages[0].id,occurredAt:evidenceAt}))});
 }
 schedulingIdea('history-inflight',{createdAt:at(-2*day),refreshedAt:at(-2*day)},{hold:true});
 schedulingIdea('history-waiting',{occurredAt:at(day)});
 const sequenceStart=seen.length;
 process.env.CYBERME_INSIGHT_VISUALS='1';tm=V.startInsightVisuals({pollMs:40});
 try{
  check('worker starts old backfill despite an exhausted legacy counter',await waitFor(()=>held.length===1&&row('history-inflight')?.status==='running'));
  S.put('ideas',{...S.get('ideas','history-waiting'),refreshedAt:at(0)});
  schedulingIdea('fresh-late',{createdAt:at(-3600000),occurredAt:undefined});
  schedulingIdea('old-with-recent-evidence',{occurredAt:undefined},{},at(-120000));
  mode['调度样例 history-inflight。'].hold=false;
  held.splice(0).forEach(release=>release());
  check('late arrivals and remaining backfill all reach ready',await waitFor(()=>['history-inflight','fresh-late','old-with-recent-evidence','history-waiting'].every(id=>row(id)?.status==='ready')));
  const order=seen.slice(sequenceStart).map(x=>x.key);
  check('recent creation and cited event overtake cosmetic refresh and future dates',order.indexOf('调度样例 fresh-late。')>=2&&order.indexOf('调度样例 old-with-recent-evidence。')>=2&&order.indexOf('调度样例 history-waiting。')>=6,order);
  for(const [id,status,error,repairError,model] of [
   ['legacy-budget-failed','failed','budget',undefined,{}],
   ['legacy-budget-rejected','rejected',undefined,'budget',{}],
   ['legacy-budget-retry-once','failed','budget',undefined,{status:500}],
   ['ordinary-timeout','failed','timeout',undefined,{}],
   ['ordinary-rejected','rejected',undefined,undefined,{}]
  ]){
   const i=schedulingIdea(id,{},model),fingerprint=V.visualFingerprint(i);
   S.db.prepare('INSERT INTO insight_visuals(idea_id,fingerprint,status,data,updated_at) VALUES(?,?,?,?,?)').run(id,fingerprint,status,JSON.stringify({ideaId:id,fingerprint,status,attempts:2,calls:1,error,repairError,updatedAt:at(0)}),at(0));
  }
  check('legacy budget failures recover at the old attempt limit',await waitFor(()=>row('legacy-budget-failed')?.status==='ready'&&row('legacy-budget-rejected')?.status==='ready'&&row('legacy-budget-retry-once')?.status==='failed'&&row('legacy-budget-retry-once')?.cause==='provider_unavailable'));
  // Several 40ms scheduler polls: a second budget recovery or an early transient retry would add calls here.
  await new Promise(r=>setTimeout(r,400));
  // The transport itself may retry a 500; count scheduler attempts, not wire requests. Current contract (insight-visuals.md
  // recovery): a provider 5xx is the transient cause provider_unavailable; it does not consume the attempt (2 legacy + 1 - 1
  // refund = 2), is counted in transientFailures and backs off 5 min. The row no longer carries the legacy `budget` stop
  // and a scheduling idea is not a new cohort, so the one-time recovery can never repeat.
  const once=row('legacy-budget-retry-once'),backoffMs=Date.parse(once.retryAfter||'')-Date.now();
  check('budget recovery is one-time and leaves unrelated terminal rows alone',once.status==='failed'&&once.error==='provider_unavailable'&&once.attempts===2&&once.transientFailures===1&&backoffMs>4*60000&&backoffMs<=5*60000&&once.calls===2&&once.requests?.length===1&&row('ordinary-timeout').calls===1&&row('ordinary-timeout').status==='failed'&&row('ordinary-rejected').calls===1&&row('ordinary-rejected').status==='rejected',{status:once.status,cause:once.cause,attempts:once.attempts,transientFailures:once.transientFailures,backoffMs,calls:once.calls,logicalRequests:once.requests?.length});
 }finally{clearInterval(tm);delete process.env.CYBERME_INSIGHT_VISUALS;held.splice(0).forEach(release=>release())}
 S.put('ideas',{...S.get('ideas','cmp'),status:'new'});
 const cb=calls;
 check('approved visual remains readable at its original fingerprint with no calls',(await item('cmp')).state==='ready'&&row('cmp').fingerprint===readyFingerprint&&calls===cb);
 // V13 unconfigured
 await writeFile(scope+'/config.json','{}');const un=await call('POST','/api/ideas/visuals/generate',{ids:['cmp']});
 check('unconfigured model: 503 and readable fallback',un.http===503&&(await item('cmp')).state!=='ready');
}catch(e){checks.push({name:'harness error',pass:false,detail:String(e?.stack||e)})}
finally{
 const summary={at:new Date().toISOString(),kind:'synthetic',ports:[46931,46932],modelCalls:calls,passed:checks.filter(c=>c.pass).length,total:checks.length,checks};
 await writeFile(out+'/http-e2e.json',JSON.stringify(summary,null,2));
 console.log(JSON.stringify({passed:summary.passed,total:summary.total,modelCalls:calls,failed:checks.filter(c=>!c.pass)},null,1));
 provider.close();process.exit(checks.every(c=>c.pass)?0:1);
}
