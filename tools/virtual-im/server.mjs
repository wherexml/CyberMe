import http from 'node:http';
import {defaultPersona,defaultStory,createDialogueEngine} from './dialogue.mjs';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(root,'../..');
const port=Number(process.env.VIRTUAL_IM_PORT||46520);
if(!Number.isInteger(port)||port<10000||port>65535)throw Error('需要五位端口');
const scope=process.env.VIRTUAL_IM_SCOPE||'default';
if(!/^[a-zA-Z0-9_-]{1,80}$/.test(scope))throw Error('Invalid scope');
const dir=path.join(project,'.local/virtual-im',scope);mkdirSync(dir,{recursive:true,mode:0o700});
const file=path.join(dir,'state.json');
const people=[
 ['product','产品与研发','群聊 · 8 人','林可','#6777df','产品'],
 ['design','周以宁','产品设计师','周以宁','#ad7bca','周'],
 ['launch','秋季发布项目','群聊 · 12 人','陈远','#438eaa','发布'],
 ['customer','客户 · 星河科技','群聊 · 6 人','徐晴','#bd8c55','星河'],
 ['ops','线上稳定性','群聊 · 9 人','王磊','#619781','运维'],
 ['finance','何嘉','财务伙伴','何嘉','#cb826e','何'],
 ['team','团队茶水间','群聊 · 16 人','苏晨','#8c93a7','茶水'],
 ['approval','审批助手','应用机器人','审批助手','#478fe8','审']
];
const scenarios={
 product:[['需求确认','@Steve 搜索页的筛选条件要不要跨会话保留？研发准备今天排期，想请你确认一下范围。','decision'],['评审邀请','@Steve 明天下午 3 点的需求评审你方便参加吗？我把议题定为消息优先级和未读恢复。','meeting'],['范围变更','客户希望本期增加批量导出。这会多占两天开发时间，你倾向于缩小首发范围还是顺延？','decision']],
 design:[['设计反馈','新版消息列表整理好了：把次要操作收进悬停区域，保留姓名和最后一条消息。你看这个方向可以继续吗？','decision'],['协作请求','研发问空状态要不要加引导按钮，我倾向于保留一个「新建会话」。你有其他考虑吗？','reply']],
 launch:[['上线确认','@Steve 灰度检查已完成，回滚方案也已更新。今晚 20:00 开始放量，可以确认吗？','decision'],['依赖催办','发布说明还缺你负责的「已知限制」部分，能在今天 17:00 前补上吗？','task'],['进度同步','移动端回归发现一处消息重复显示，正在修复。预计发布窗口会延后半小时，请知悉。','notice']],
 customer:[['客户催办','@Steve 我们周四要给管理层演示，想先确认下单点登录的交付日期，今天可以给个明确答复吗？','reply'],['客户反馈','我们这边有三位同事说未读数没有及时更新。刷新后恢复了，麻烦帮忙看一下。','incident'],['方案确认','试点先开 30 个账号，数据保留 90 天。如果没有问题，我就按这个口径发内部通知了。','decision']],
 ops:[['线上告警','@Steve 消息队列的延迟升到了 8 秒，当前只有小部分用户受影响。值班同学正在排查，是否先暂停新一轮灰度？','incident'],['恢复通知','队列积压已经消化，延迟恢复到 200ms 以下。我们会继续观察，稍后补排查记录。','notice']],
 finance:[['报销补件','这笔差旅报销还缺酒店的住宿水单，麻烦有空补一下，周五下午会统一付款。','task'],['预算确认','下个月云资源预算预计比本月增加 15%，主要是客户试点扩容。需要你确认预算上限。','decision']],
 team:[['团队日常','周五午饭想一起去楼下新开的面馆，有空的同学接龙～','notice'],['资料分享','把今天分享会的重点整理好了：上线前先验证恢复路径，遇到不确定的发送结果先回查。','notice']],
 approval:[['采购审批','陈远提交了测试设备采购申请\n金额：¥ 3,680\n用途：移动端消息兼容性测试\n请确认是否同意采购。','approval'],['请假审批','苏晨申请下周三下午调休半天，已与值班同事完成交接。请审批。','approval']]
};
// Keep the ongoing product stream varied across longer practice sessions.
scenarios.product.push(
 ['接口对齐','@Steve 联调发现客户端仍在用旧版分页字段。想把兼容层再保留一周，你看可以吗？','decision'],
 ['体验反馈','今天的试用反馈集中在两点：新消息提醒太频繁，以及草稿切换容易丢。你希望我们优先解决哪一个？','reply'],
 ['排期协调','QA 需要半天补充弱网回归，但这会占用明天的演示环境。可以先把演示切到备用环境吗？','task'],
 ['验收确认','消息撤回和未读恢复已完成联调。麻烦确认验收时是否还要覆盖多窗口同时在线的情况。','decision'],
 ['版本回顾','这轮灰度里有两条用户反馈很有参考价值，我已经整理到评审议题。下次例会一起看？','meeting'],
 ['依赖更新','设计资源已交付，研发还在等接口字段确认。你方便帮忙约一下数据同学今天对齐吗？','task']
);
const initial=()=>({instanceId:randomUUID(),aiJobs:[],version:2,revision:0,running:true,interval:20,mode:'mixed',seq:0,nextAt:Date.now()+20000,conversations:people.map(([id,name,subtitle,sender,color,avatar])=>({id,name,subtitle,sender,color,avatar,readAt:0})),messages:[],receipts:{},pending:[]});
let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):initial();
function add(s,cid,entry){const c=s.conversations.find(c=>c.id===cid);s.seq++;const [title,text,kind]=entry;const m={id:randomUUID(),cid,seq:s.seq,title,text,kind,sender:c.sender,time:Date.now(),direction:'in',status:kind==='notice'?'info':'pending'};s.messages.push(m);return m;}
function generate(s){const ids=s.mode==='pressure'?['ops','customer','launch','approval']:s.mode==='daily'?['product','design','finance','team']:people.map(p=>p[0]);for(let n=0;n<ids.length;n++){const cursor=s.generationCursor??s.seq;s.generationCursor=cursor+1;const cid=ids[cursor%ids.length],pool=scenarios[cid],topic=pool[Math.floor(cursor/ids.length)%pool.length];if(engine?.provider().configured||engine?.provider().error){const job=engine.enqueue(s,cid,{topic});if(job.waiting)continue;return job;}return add(s,cid,topic);}return {waiting:true};}
function persist(next){next.revision++;writeFileSync(file+'.tmp',JSON.stringify(next),{mode:0o600});renameSync(file+'.tmp',file);state=next;}
function mutate(fn){const next=structuredClone(state);const result=fn(next);persist(next);return result;}
let engine;
if(!existsSync(file))mutate(s=>{for(const cid of ['product','design','approval','customer','team'])add(s,cid,scenarios[cid][0]);});
mutate(s=>{s.instanceId??=randomUUID();s.aiJobs??=[];for(const c of s.conversations){c.persona??=defaultPersona(c.id);c.story??=defaultStory(c.id);c.decisionVersion??=0;}for(const j of s.aiJobs)if(j.status==='running'){j.status='unknown';j.error='服务重启，原模型结果未确认';}});
engine=createDialogueEngine({project,readState:()=>state,mutate,addMessage:add});
let diskError='';
setInterval(()=>{try{const now=Date.now();if((state.running&&now>=state.nextAt)||state.pending.some(p=>p.at<=now))mutate(s=>{for(const p of s.pending.filter(p=>p.at<=now))add(s,p.cid,['回复跟进',p.text,'notice']);s.pending=s.pending.filter(p=>p.at>now);if(s.running&&now>=s.nextAt){if(s.messages.length>=5000){s.running=false;}else generate(s);s.nextAt=now+s.interval*1000;}});diskError='';}catch{diskError='存储失败，自动来信尚未保存，请检查磁盘后重试';}},500).unref();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
http.createServer(async(req,res)=>{try{
 const host=req.headers.host;if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,403,{error:'仅限本机访问'});
 const url=new URL(req.url,`http://${host}`);
 if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,{...state,provider:engine.provider(),storageError:diskError});
 if(req.method==='GET'&&url.pathname==='/api/connector')return json(res,200,{protocol:'opstwins.virtual-im.v1',instanceId:state.instanceId,maxSeq:state.seq,conversations:state.conversations.map(({id,name,subtitle,sender,persona})=>({id,name,subtitle,sender:persona.name}))});
 if(req.method==='GET'&&url.pathname==='/api/connector/messages'){const after=Number(url.searchParams.get('after')||0),limit=Number(url.searchParams.get('limit')||100);if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>200)return json(res,400,{error:'分页参数无效'});const rows=state.messages.filter(m=>m.seq>after).sort((a,b)=>a.seq-b.seq);const items=rows.slice(0,limit);return json(res,200,{instanceId:state.instanceId,items,nextSeq:items.at(-1)?.seq||after,hasMore:rows.length>limit,maxSeq:state.seq});}
 if(req.method==='GET'&&url.pathname.startsWith('/api/connector/receipts/')){const key=decodeURIComponent(url.pathname.split('/').at(-1));const receipt=state.receipts[key];return json(res,receipt?200:404,receipt?{...receipt,instanceId:state.instanceId,requestId:key}:{error:'receipt_not_found',instanceId:state.instanceId});}
 if(req.method==='GET'&&url.pathname==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="virtual-im.json"');return json(res,200,state);}
 if(req.method==='POST'&&['/api/action','/api/connector/reply'].includes(url.pathname)){
 if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return json(res,403,{error:'来源不允许'});
 if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'需要JSON'});
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>24000)return json(res,413,{error:'消息过长'});}const body=JSON.parse(raw);if(url.pathname==='/api/connector/reply'){if(body.instanceId!==state.instanceId)return json(res,409,{error:'虚拟工作区已改变'});body.action='reply';}
 const result=mutate(s=>{
 const c=s.conversations.find(c=>c.id===body.cid);
 if(body.action==='settings'){if(body.interval!==undefined){if(![5,20,60].includes(body.interval))throw Error('无效来信速度');s.interval=body.interval;}if(body.mode!==undefined){if(!['mixed','daily','pressure'].includes(body.mode))throw Error('无效场景');s.mode=body.mode;}if(body.running!==undefined){if(typeof body.running!=='boolean')throw Error('无效运行状态');s.running=body.running;}s.nextAt=Date.now()+s.interval*1000;return {ok:true};}
 if(body.action==='generate'){if(s.messages.length>=5000)throw Error('记录已满，请先导出保存');return generate(s);}
 if(!c)throw Error('会话不存在');
 if(body.action==='read'){c.readAt=s.seq;return {ok:true};}
 if(body.action==='persona'){if(body.baseVersion!==c.persona.version)throw Error('角色设置已更新，请重新打开后保存');const input=body.persona;for(const field of ['name','role','background','style','instructions'])if(typeof input?.[field]!=='string'||input[field].length>2000||(['name','role','style'].includes(field)&&!input[field].trim()))throw Error('角色内容无效');c.persona={...Object.fromEntries(['name','role','background','style','instructions'].map(k=>[k,input[k].trim()])),version:c.persona.version+1};c.sender=c.persona.name;if(['design','finance'].includes(c.id))c.name=c.persona.name;return c.persona;}
 if(body.action==='ai-retry')return engine.retry(s,body.id);
 if(body.action==='reply'){
 if(typeof body.requestId!=='string'||!/^[\w-]{1,80}$/.test(body.requestId))throw Error('请求标识无效');
 if(s.receipts[body.requestId]){const r=s.receipts[body.requestId];if(r.cid!==c.id||r.text!==body.text)throw Error('请求内容冲突');return r;}
 if(url.pathname==='/api/connector/reply'&&(!Number.isSafeInteger(body.expectedSeq)||body.expectedSeq!==(s.messages.filter(m=>m.cid===c.id).at(-1)?.seq||0)))throw Object.assign(Error('会话已有新消息，请刷新后回复'),{httpStatus:409});
 if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)throw Error('请输入1–4000字消息');
 const m={id:randomUUID(),cid:c.id,seq:++s.seq,text:body.text.trim(),sender:'Steve',time:Date.now(),direction:'out',kind:'reply',status:'sent'};s.messages.push(m);s.receipts[body.requestId]={id:m.id,cid:c.id,text:body.text};if(engine.provider().configured||engine.provider().error)engine.enqueue(s,c.id,{triggerId:m.id});else s.pending.push({cid:c.id,at:Date.now()+2500,text:'收到你的回复了。我会按这个安排继续推进，有新的进展再同步给你。'});return s.receipts[body.requestId];}
 const m=s.messages.find(m=>m.id===body.id&&m.cid===c.id&&m.direction==='in');if(!m)throw Error('事项不存在');
 if(body.action==='handle'){if(!['done','later','pending','approved','rejected'].includes(body.status))throw Error('状态无效');if(['approved','rejected'].includes(body.status)&&m.kind!=='approval')throw Error('非审批事项');const changed=m.status!==body.status;m.status=body.status;if(changed&&['approved','rejected'].includes(body.status)){c.decisionVersion=(c.decisionVersion||0)+1;if(engine.provider().configured||engine.provider().error)engine.enqueue(s,c.id,{triggerId:'decision-'+m.id+'-'+c.decisionVersion});}return {ok:true};}throw Error('操作不存在');
 });return json(res,200,url.pathname==='/api/connector/reply'?{...result,instanceId:state.instanceId,requestId:body.requestId}:result);
 }
 if(req.method!=='GET')return json(res,405,{error:'不支持的操作'});
 const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};if(!assets[url.pathname])return json(res,404,{error:'未找到'});
 const ext=path.extname(assets[url.pathname]);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"});res.end(readFileSync(path.join(root,assets[url.pathname])));
 }catch(e){json(res,e.httpStatus||(e instanceof SyntaxError?400:422),{error:e.code?'存储失败，请保留草稿后重试':e.message});}
}).listen(port,'127.0.0.1',()=>console.log(`Virtual IM http://127.0.0.1:${port} · scope=${scope}`));
