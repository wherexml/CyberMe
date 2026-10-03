import {generateArtifact} from './artifacts';
import {get,list,put,hash,publicValue} from './store';

export function automaticFilePlan(item:any,preferences:string[],requestId:string){
 const text=`${item.title||''}\n${item.body||''}`;
 const linked=[...new Set<string>((item.context||[]).filter((id:any)=>typeof id==='string'&&(get('tasks',id)||get('projects',id))))];
 const hasData=linked.some(id=>get('tasks',id)||list('tasks').some(t=>t.projectId===id));
 const kinds:string[]=[];const skipped:any[]=[];
 // Match explicit omission requests, not safety clauses such as 'do not fabricate a chart'.
 const omit=(noun:string)=>new RegExp(`\\b(?:no|without)\\s+(?:(?:any|a|an|the)\\s+)?(?:${noun})\\b|\\bno\\s+need\\s+for\\s+(?:(?:any|a|an|the)\\s+)?(?:${noun})\\b|\\b(?:do not|don't)\\s+(?:create|generate|add|include|attach|make|draw|produce)\\s+(?:(?:a|an|any|the)\\s+)?(?:${noun})\\b`,'i').test(text);
 if(!/(不要|无需|不需要|不用|别)(?:生成|添加|制作|附上)?(?:PDF|报告|摘要)/i.test(text)&&!omit('pdf|reports?|summary|summaries')&&preferences.includes('pdf')&&/\b(pdf|reports?|summary|summaries|summari[sz]e)\b|摘要|总结|汇总|报告/i.test(text))kinds.push('pdf');
 if(!/(不要|无需|不需要|不用|别)(?:生成|添加|制作|附上)?(?:图表|图片)/i.test(text)&&!omit('charts?|graphs?|diagrams?')&&preferences.includes('charts')&&/\b(charts?|graphs?|visuali[sz]e|diagrams?)\b|图表|可视化|进度图/i.test(text)){if(hasData)kinds.push('chart');else skipped.push({kind:'chart',reason:'no_related_task_data'});}
 return {requestId,kinds,sourceIds:[item.id,...linked],preferences:[...preferences],skipped};
}
export const automaticDraftHash=(item:any)=>hash({draft:item.draft,body:item.body,context:item.context||[]});
export async function generateAutomaticFiles(item:any,plan:any,runId:string,conversationId:string){
 const artifacts:any[]=[];const errors:any[]=[];
 for(const kind of plan.kinds){
  try{let artifact=list('artifacts').find(a=>a.automaticRequestId===plan.requestId&&a.kind===kind);
   if(!artifact){artifact=await generateArtifact({kind,title:`${item.title.slice(0,170)} — ${kind==='pdf'?'Summary':'Chart'}`,content:kind==='pdf'?`${item.draft}\n\nSource data\n${plan.sourceIds.map((id:string)=>{const task=get('tasks',id),project=get('projects',id);if(task)return `Task ${task.id}: ${task.title}; status=${task.status}; due=${task.dueDate||'not set'}`;if(project)return `Project ${project.id}: ${project.title}\n${list('tasks').filter(t=>t.projectId===id).map(t=>`Task ${t.id}: ${t.title}; status=${t.status}; due=${t.dueDate||'not set'}`).join('\n')}`;return id===item.id?`Reply source ${id}`:`Source unavailable at generation: ${id}`;}).join('\n')}`:item.draft,sourceIds:kind==='pdf'?plan.sourceIds.filter((id:string)=>id===item.id||get('tasks',id)||get('projects',id)):plan.sourceIds,runId,conversationId});artifact=put('artifacts',{...artifact,automaticRequestId:plan.requestId,sourceInboxId:item.id,requestedSourceIds:plan.sourceIds});}
   artifacts.push(artifact);
  }catch(e){errors.push({kind,message:publicValue(String(e))});}
 }
 return {artifacts,state:{plan,runId,conversationId,draftHash:automaticDraftHash(item),status:errors.length?'partial':'complete',artifactIds:artifacts.map(a=>a.id),errors,skipped:plan.skipped}};
}
