// Maps canonical records to V6 card models. Status is projected truthfully: a chosen
// option is only "sent to CyberMe", never "done", and unknown/partial stay visible.
import type {InboxItem,Idea,Task,Automation} from '../../../shared/types';
import {dispositionOf} from '../../../shared/inbox-surfacing';
import {readVisual,readMeters,readSteps,type DecisionVisual,type DecisionMeters,type InsightVisual,type GalleryVisual,type WorkVisual,V6_GALLERY_KINDS,V6_WORK_KINDS,type V6Text,v6Text} from '../../../shared/v6-visuals';
import {inFlight,type Workspace,type UIState,type ChatRecord,type Proposal} from './store';
import {proposalForTask,proposalState,emailSteps} from './proposal-state';
import type {PillStatus} from './ui';
import {firstPara,plain} from './md';
import {deriveDecision,deriveGallery} from './derive';

export const today=()=>new Date().toISOString().slice(0,10);
export const tomorrow=()=>new Date(Date.now()+864e5).toISOString().slice(0,10);
const v6=(x:any)=>x&&x.v6&&typeof x.v6==='object'&&!Array.isArray(x.v6)?x.v6:{};
const str=(v:unknown)=>typeof v==='string'&&v.length<=200?v:undefined;

export interface DecisionOpt{label:string;effect?:string;next?:string;rec:boolean}
export interface DecisionModel{id:string;kind:'inbox';q:string;ctx:string;due:string;urgent:boolean;opts:DecisionOpt[];visual:DecisionVisual|null;meters:DecisionMeters|null;prec:string;why:string[];item:InboxItem}
export function decisions(ws:Workspace,ui:UIState,zh:boolean):DecisionModel[]{
 const out:DecisionModel[]=[];
 for(const item of ws.inbox||[]){
  let pending=false;try{pending=dispositionOf(item).placement==='pending'}catch{}
  const mark=ui.brief[item.id];if(!pending&&!mark)continue;
  const x=v6(item),tri:any=(item as any).triage||{};
  const urgent=tri.priority==='high'||!!x.urgent;
  const due=x.due?v6Text(x.due,zh):(item as any).dueDate?fmtDay((item as any).dueDate,zh):urgent?(zh?'今天':'Today'):'';
  const xo=Array.isArray(x.options)?x.options.filter((o:any)=>o&&typeof o==='object'&&!Array.isArray(o)):[];
  const opts:DecisionOpt[]=xo.length?xo.map((o:any)=>({label:v6Text(o.label,zh),effect:o.effect?v6Text(o.effect,zh):undefined,next:o.next?v6Text(o.next,zh):undefined,rec:!!o.recommended}))
   :defaultOptions(item,zh);
  out.push({id:item.id,kind:'inbox',q:x.question?v6Text(x.question,zh):item.title,ctx:x.context?v6Text(x.context,zh):plain((item as any).summary||tri.reason||item.body,220),due,urgent,opts,
   visual:readVisual<DecisionVisual>(x.visual,['accts','quiet','gantt'])??deriveDecision(item),meters:readMeters(x.meters),
   prec:x.precedent?v6Text(x.precedent,zh):(tri.priorityReason||''),why:Array.isArray(x.why)&&x.why.length?x.why.map((w:V6Text)=>v6Text(w,zh)):(zh?['最重要','最省事','风险最低']:['Matters most now','Least effort','Lowest risk']),item});
 }
 return out.sort((a,b)=>Number(b.urgent)-Number(a.urgent));
}
function defaultOptions(item:InboxItem,zh:boolean):DecisionOpt[]{
 const tri:any=(item as any).triage||{};const reply=tri.actionType==='reply'||['quick_reply','deep_reply','review'].includes(tri.route);
 const draft=zh?'起草一封回复，等我确认':'Draft a reply for my review',none=zh?'不需要回复，标记为已处理':'No reply needed, mark it handled',task=zh?'转成任务稍后处理':'Turn it into a task for later';
 return reply?[{label:draft,rec:true},{label:task,rec:false},{label:none,rec:false}]:[{label:task,rec:true},{label:draft,rec:false},{label:none,rec:false}];
}
export function fmtDay(value:string,zh:boolean){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return zh?`${d.getMonth()+1} 月 ${d.getDate()} 日`:d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}
export function relTime(value:string|undefined,zh:boolean){
 if(!value)return '';const t=Date.parse(value);if(!Number.isFinite(t))return '';const m=Math.round((Date.now()-t)/60000);
 if(m<1)return zh?'刚刚':'Just now';if(m<60)return zh?`${m} 分钟前`:`${m} min ago`;const h=Math.round(m/60);if(h<24&&new Date(t).getDate()===new Date().getDate())return zh?`${h} 小时前`:`${h} hour${h>1?'s':''} ago`;
 const d=Math.floor((new Date().setHours(0,0,0,0)-new Date(t).setHours(0,0,0,0))/86400000);if(d===1)return zh?'昨天':'Yesterday';if(d<7)return zh?`${d} 天前`:`${d} days ago`;return fmtDay(value,zh);
}

// Brief › Inspirations: verification-needed items first (judgment cards), then Ideas gallery.
export interface InsightModel{id:string;title:string;summary:string;status:string;tone:'accent'|'warn'|'muted'|'ok';visual:InsightVisual|null;actions:{label:string;prompt:string;primary?:boolean}[];sources:{name:string;quote:string}[];item:InboxItem}
export function insights(ws:Workspace,zh:boolean,T:any):InsightModel[]{
 const out:InsightModel[]=[];
 for(const item of ws.inbox||[]){const m=insightOf(item,zh,T);if(m)out.push(m)}
 return out;
}
/** The list projection of one verify item; the detail view binds the same title, summary, status and tone. */
export function insightOf(item:InboxItem,zh:boolean,T:any):InsightModel|null{
 let d:any;try{d=dispositionOf(item)}catch{return null}if(d.placement!=='verify')return null;
 const x=v6(item);const thin=thinEvidence(item);const changed=!thin&&/source|time|context/.test(d.primaryReason);
 // Proven insufficient evidence uses the reference thin-evidence card (R:1683, 1804): "Not enough evidence", muted tone,
 // Watch for more / Dismiss prompts. Changed or unsafe verify cases keep the warn re-check card.
 const actions=thin?[{label:T.watch,prompt:zh?'继续关注，有更多再告诉我。':'Keep watching and tell me if more come in.'},{label:T.dismiss,prompt:zh?'忽略这条洞察。':'Dismiss this insight.'}]
  :[{label:zh?'重新核对来源':'Re-check sources',prompt:zh?'帮我重新核对这条事项的来源。':'Re-check the sources for this item.',primary:true},{label:T.dismiss,prompt:zh?'这条不用处理了，忽略吧。':"This doesn't need anything, dismiss it."}];
 return {id:item.id,title:x.title?v6Text(x.title,zh):item.title,summary:x.summary?v6Text(x.summary,zh):plain(item.body,200),status:thin?T.st.thin:changed?T.st.changed:T.st.unknown,tone:thin?'muted':'warn',visual:readVisual<InsightVisual>(x.visual,['renew','cal','sig']),
  actions,sources:sourcesOf(item),item};
}
/** Genuine insufficient-signal evidence (reference "Not enough evidence", R:1683): a verify item whose own successful
 *  judgment reports missing context (missingContext ≥ .5) or an unknown resolution/action. Sensitive, failed or pending
 *  judgments, unknown times, unavailable sources, send/draft/processing failures, recalls and unverified closures are
 *  verify cases too, but they are not thin evidence. */
export function thinEvidence(item:InboxItem):boolean{
 let d:any;try{d=dispositionOf(item)}catch{return false}
 if(d.placement!=='verify'||d.primaryReason!=='context_unknown')return false;
 if(!(d.recoveryReasons as string[]).every(r=>r==='context_unknown'))return false;
 const it:any=item,t=it.triage;
 if(t?.status!=='succeeded'||it.sensitive||it.sourceUnavailable)return false;
 if(['sent','delivered','done','dismissed','cancelled','recalled','sending','send_unknown','send_failed','failed'].includes(String(it.status)))return false;
 return (t.missingContext??0)>=.5||t.resolution==='unknown'||t.actionType==='unknown';
}
export function sourcesOf(item:InboxItem):{name:string;quote:string}[]{
 const msgs=Array.isArray((item as any).messages)?(item as any).messages:[];
 const rows=msgs.slice(-4).map((m:any)=>({name:String(m.sender||m.from||item.sender||item.channel||''),quote:plain(String(m.text||m.body||m.content||''),280)})).filter((r:any)=>r.quote);
 return rows.length?rows:[{name:[item.sender,item.channel].filter(Boolean).join(' · '),quote:plain(item.body,400)}];
}
export interface GalleryModel{id:string;kind:string;icon:string;color:string;when:string;title:string;body:string;act:string;action:string;visual:GalleryVisual|null;idea:Idea}
const CAT:Record<string,[string,string,string,string]>={productivity:['ph-sun-horizon','#ff9f0a','Focus','专注'],automation:['ph-clock-counter-clockwise','#30b0c7','Routine','例行'],communication:['ph-users-three','#5e5ce6','Relationships','人脉'],insight:['ph-brain','#af52de','Pattern','规律']};
export function gallery(ws:Workspace,zh:boolean):GalleryModel[]{
 return (ws.ideas||[]).filter(i=>!['executed','dismissed','archived'].includes(i.status)).map(idea=>{
  const x=v6(idea),c=CAT[idea.category]||['ph-lightbulb','#0a84ff','Idea','灵感'];const action=idea.action||'task';
  const act=x.act?v6Text(x.act,zh):({task:zh?'创建任务':'Create a task',draft:zh?'起草草稿':'Draft it',automation:zh?'设置例行任务':'Set up a routine',file:zh?'整理成文件':'Make it a file'} as any)[action]||(zh?'处理这件事':'Take care of it');
  return {id:idea.id,kind:x.kind?v6Text(x.kind,zh):c[zh?3:2],icon:str(x.icon)||c[0],color:str(x.color)||c[1],when:x.when?v6Text(x.when,zh):relTime(idea.createdAt,zh),title:idea.title,body:x.body?v6Text(x.body,zh):firstPara(idea.description,220),act,action,visual:readVisual<GalleryVisual>(x.visual,V6_GALLERY_KINDS)??deriveGallery(idea,ws.inbox||[]),idea};
 });
}

// Tasks › work cards (chat work panels and items) and plain task list.
export interface WorkStep{short:string;label:string;detail:string;done:boolean;run:boolean}
export type WorkState='review'|'running'|'done'|'failed'|'file_failed'|'cancelled'|'interrupted'|'partial'|'unknown'|'chosen'|'stale'|'closed';
export interface WorkModel{id:string;state:WorkState;when:string;title:string;summary:string;steps:WorkStep[];visual:WorkVisual|null;chosen?:{label:string;summary?:string};choices:{label:string;rec:boolean;optionId:string}[];followups:{label:string;rec:boolean}[];taskId?:string;panel?:any;work?:any;pct?:number;error?:string}
// Steps the record itself carries (validated) win over the generic lifecycle steps.
const ownSteps=(x:any,zh:boolean):WorkStep[]|null=>{const st=readSteps(x.steps);return st?st.map(s=>({short:v6Text(s.short,zh),label:v6Text(s.label,zh),detail:v6Text(s.detail,zh),done:s.done,run:s.run})):null};
export function workCards(ws:Workspace,zh:boolean):WorkModel[]{
 const out:WorkModel[]=[];const w=ws.work||{panels:[],works:[]};
 const S=(en:string,z:string)=>zh?z:en;
 // Every panel is kept: only `ready` accepts a choice; consumed/stale/retired panels stay visible as closed states.
 for(const p of w.panels||[]){const x=v6(p);const ready=p.status==='ready';const pst:WorkState=ready?'review':p.status==='consumed'?'chosen':p.status==='stale'?'stale':'closed';
  out.push({id:p.id,state:pst,when:relTime(p.updatedAt||p.createdAt,zh),title:x.title?v6Text(x.title,zh):plain(p.prompt,120),summary:x.summary?v6Text(x.summary,zh):(p.sources||[]).map((s:any)=>s.title).filter(Boolean).slice(0,3).join(' · '),
   steps:ownSteps(x,zh)||[{short:S('Read','读取'),label:S('Read the linked sources','读取关联资料'),detail:(p.sources||[]).length+S(' sources',' 份资料'),done:true,run:false},{short:S('Options','方向'),label:S('Prepared directions to choose from','准备好可选方向'),detail:(p.options||[]).length+S(' options',' 个方向'),done:true,run:false},{short:S('Your call','你的判断'),label:ready?S('Waiting for your choice','等你选择'):pst==='chosen'?S('You chose a direction','你已选择方向'):pst==='stale'?S('Sources changed; choose again from a new proposal','来源已变化，需要新的方向'):S('No longer open for a choice','已不能再选择'),detail:ready?S('Nothing runs until you choose','选择前不会执行'):'',done:pst==='chosen',run:false}],
   visual:readVisual<WorkVisual>(x.visual,V6_WORK_KINDS),chosen:pst==='chosen'?chosenOf(p):undefined,choices:(ready?p.options||[]:[]).map((o:any)=>({label:o.label,rec:!!o.recommended,optionId:o.id})),followups:[],panel:p});}
 for(const k of w.works||[]){const x=v6(k);const st=k.status;
  // Real states stay distinct: partial is not unknown, interrupted is not awaiting a choice, and an unrecognised status is unknown.
  const state:WorkState=['completed','succeeded'].includes(st)?'done':['failed','file_failed','cancelled','interrupted','partial'].includes(st)?st:['queued','preparing','running','in_progress','writing_file','cancelling'].includes(st)?'running':'unknown';
  const arts=(k.artifacts||[]).filter((a:any)=>a&&!a.missing);
  out.push({id:k.id,state,when:relTime(k.updatedAt||k.createdAt,zh),title:x.title?v6Text(x.title,zh):k.title,summary:x.summary?v6Text(x.summary,zh):k.error||(arts.length?arts.map((a:any)=>a.name).join(' · '):''),
   steps:ownSteps(x,zh)||[{short:S('Chosen','已选择'),label:S('You chose this direction','你选择了这个方向'),detail:relTime(k.createdAt,zh),done:true,run:false},{short:S('Working','处理'),label:S('Working through the sources','根据资料处理'),detail:k.native?.engine||'',done:state==='done',run:state==='running'},{short:S('Result','结果'),label:state==='done'?S('Result saved','结果已保存'):state==='partial'?S('Partly saved','部分保存'):state==='file_failed'?S('File check failed','文件校验失败'):['failed','cancelled','interrupted'].includes(state)?S('Stopped before finishing','未完成即停止'):state==='unknown'?S('Result not confirmed','结果未确认'):S('Result','结果'),detail:arts.length?arts.length+S(' files',' 个文件'):'',done:state==='done',run:false}],
   visual:readVisual<WorkVisual>(x.visual,V6_WORK_KINDS),choices:[],followups:state==='done'?followupsOf(x,zh):[],taskId:typeof k.task?.id==='string'&&k.task.id?k.task.id:undefined,work:k,pct:typeof x.pct==='number'&&Number.isFinite(x.pct)?Math.max(0,Math.min(100,x.pct)):undefined,error:k.error});}
 return out;
}
/** The accepted option of a consumed panel: exact `selectedOptionId` match against the panel's own options, using only a
 *  non-empty string label and an optional string summary (trimmed, bounded). Anything else yields no summary. */
function chosenOf(p:any):{label:string;summary?:string}|undefined{
 const id=p?.selectedOptionId;if(typeof id!=='string'||!id||!Array.isArray(p.options))return;
 const o=p.options.find((x:any)=>x&&typeof x==='object'&&x.id===id);if(!o||typeof o.label!=='string')return;
 const label=o.label.trim().slice(0,200);if(!label)return;
 const summary=typeof o.summary==='string'?o.summary.trim().slice(0,300):'';
 return summary?{label,summary}:{label};
}
/** Record-provided follow-up choices of a completed work item (`v6.followups`: [{label: text|[en,zh], recommended?}]).
 *  Invalid entries are dropped; at most 4. They only prefill the conversation — they never select or undo work. */
function followupsOf(x:any,zh:boolean):{label:string;rec:boolean}[]{
 if(!Array.isArray(x.followups))return [];
 return x.followups.filter((f:any)=>f&&typeof f==='object'&&(f.recommended===undefined||typeof f.recommended==='boolean')).map((f:any)=>({label:v6Text(f.label,zh).trim(),rec:f.recommended===true})).filter((f:any)=>f.label&&f.label.length<=200).slice(0,4);
}
export interface TaskModel{id:string;title:string;status:PillStatus;meta:string;kind:'task'|'automation';raw:Task|Automation;steps:string[];step:number}
export function taskStatus(t:any):PillStatus{
 if(t.completed===true)return 'done';const s=String(t.status||'').toLowerCase();
 if(['done','completed','succeeded'].includes(s))return 'done';if(['failed','error'].includes(s))return 'failed';if(['blocked','waiting','review','needs_review','awaiting_approval'].includes(s))return 'confirm';
 if(['in_progress','doing','running','active'].includes(s))return 'running';if(['unknown','send_unknown'].includes(s))return 'unknown';if(s==='partial')return 'partial';if(['cancelled','canceled'].includes(s))return 'cancelled';return 'queued';
}
/** `proposals`: a created V6 proposal's exact canonical task id is shown with the shared proposal projection
 *  (status, four reference steps) so the row agrees with the chat event and the detail; every other task is generic. */
export function taskList(ws:Workspace,zh:boolean,proposals:Proposal[]=[]):TaskModel[]{
 const linked=new Set((ws.work?.works||[]).map((w:any)=>w.task?.id).filter(Boolean));
 const steps=zh?['已记录','进行中','完成']:['Captured','In progress','Done'];
 const rows:TaskModel[]=(ws.tasks||[]).filter(t=>!linked.has(t.id)).map(t=>{const prop=proposalForTask(proposals,t.id);if(prop){const ps=proposalState(prop,ws.inbox||[]);const es=emailSteps(zh);
   return {id:t.id,title:t.title,status:ps.status,meta:ps.status==='done'?'':es[Math.min(ps.step,es.length-1)],kind:'task',raw:t,steps:es,step:ps.step}}
  const status=taskStatus(t);return {id:t.id,title:t.title,status,meta:status==='done'?'':[t.dueDate?fmtDay(t.dueDate,zh):'',(ws.projects||[]).find(p=>p.id===t.projectId)?.title||''].filter(Boolean).join(' · '),kind:'task',raw:t,steps,step:status==='done'?3:status==='running'||status==='confirm'?1:0}});
 for(const a of ws.automations||[])if(a.enabled)rows.push({id:a.id,title:a.title,status:'scheduled',meta:a.nextRun?(zh?'下次 ':'Next ')+fmtDay(a.nextRun,zh):a.schedule,kind:'automation',raw:a,steps:zh?['等待时间','执行','提醒你']:['Wait for schedule','Run','Tell you'],step:0});
 const rank:Record<string,number>={confirm:0,failed:1,unknown:1,partial:1,interrupted:1,running:2,sending:2,queued:2,scheduled:3,cancelled:4,paused:4,done:5};
 return rows.sort((a,b)=>(rank[a.status]??3)-(rank[b.status]??3));
}

// Capsule state from real activity.
export function mood(ui:UIState,ws:Workspace|null,conversationId:string|null):{mode:'think'|'work'|'wait'|'idle';running:number}{
 const thinking=ui.requests.some((r:ChatRecord)=>r.conversationId===conversationId&&inFlight(r));
 const works=ws?.work?.works||[];const running=works.filter((w:any)=>['queued','preparing','running','in_progress','writing_file'].includes(w.status)).length;
 const waiting=(ws?.work?.panels||[]).some((p:any)=>p.status==='ready');
 return {mode:thinking?'think':running?'work':waiting?'wait':'idle',running};
}
