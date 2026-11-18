import {readFileSync,readdirSync,realpathSync,statSync} from 'node:fs';
import {join,basename,sep} from 'node:path';
import {settings,hash,list,get,put} from './store';
import {analysisOwner} from './analysis-context';

type Person={id:string;name:string;aliases:string[];role:string;relationship:string;reviewedAt:string;markdown:string;fingerprint:string;truncated:boolean};
export type EmploymentStatus='active'|'left';

// Match a whole direct statement, never an occurrence inside a question or supplied material.
export function personStatusStatement(text:string){
 const m=text.trim().match(/^(?:(?:记住|更正)[：:，,][ \t]*)?([\p{L}][\p{L}\p{M} ·.'’-]{0,48}?)[ \t]*(?:(?:已经|已|现在|目前)[ \t]*)?(离职|在岗|重新入职|复职|返岗)(了)?[。.!！]?$/u);
 if(!m||(!['离职','在岗'].includes(m[2])&&!m[3]&&!/(?:已经|已)[ \t]*(?:重新入职|复职|返岗)/.test(text)))return undefined;
 return {name:m[1].trim().toLocaleLowerCase(),status:(m[2]==='离职'?'left':'active') as EmploymentStatus};
}
export function matchPersonStatus(statement:NonNullable<ReturnType<typeof personStatusStatement>>,context:ReturnType<typeof peopleContext>){
 // If a directory couldn't be read or the scan hit its cap, uniqueness is unconfirmed.
 if(context.coverage.unavailable.length||context.coverage.loaded>=context.coverage.limit)return undefined;
 const matches=context.people.filter(p=>p.aliases.some(a=>a.toLocaleLowerCase()===statement.name));
 return matches.length===1?matches[0]:undefined;
}
// Only explicitly configured folders with the personnel template are traversed.
// Nothing is copied into the repository or written back over the human Wiki.
export function peopleContext(){
 const owner=analysisOwner(settings().identity),people:Person[]=[],unavailable:string[]=[];
 for(const entry of settings().knowledgePaths||[]){
  try{
   const root=realpathSync(entry.path);
   const template=readFileSync(join(root,'TEMPLATE.md'),'utf8');
   if(!template.includes('## 基本信息'))continue;
   const walk=(dir:string,depth:number)=>{
    for(const file of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
     if(file.isSymbolicLink()||file.name.startsWith('.'))continue;
     const path=join(dir,file.name);
     if(file.isDirectory()&&depth<2){walk(path,depth+1);continue;}
     if(!file.isFile()||!file.name.endsWith('.md')||/^(README|TEMPLATE|AGENTS|CLAUDE)\.md$/i.test(file.name)||people.length>=100)continue;
     if(!realpathSync(path).startsWith(root+sep)||statSync(path).size>200000)continue;
     const markdown=readFileSync(path,'utf8');if(!markdown.includes('## 基本信息'))continue;
     const cell=(key:string)=>markdown.match(new RegExp('^\\| '+key+' \\| ([^|]*)\\|','m'))?.[1]?.trim()||'';
     const name=cell('中文名')||basename(file.name,'.md');
     const aliases=[name,...(cell('英文名').split(/[／/、,，]/).map(x=>x.trim()).filter(x=>x&&x.length<50))];
     people.push({id:'person-wiki-'+hash([entry.id,path]).slice(0,24),name,aliases,role:cell('当前角色')||markdown.match(/^> (?:当前角色|角色)：(.+)$/m)?.[1]?.trim()||'',relationship:cell('与 Steve 的关系')||'待确认',reviewedAt:markdown.match(/^> 资料更新时间：(.+)$/m)?.[1]?.trim()||'',markdown:markdown.slice(0,12000),fingerprint:hash(markdown),truncated:markdown.length>12000});
    }
   };walk(root,0);
  }catch{unavailable.push(entry.id);}
 }
 return {owner,people,coverage:{loaded:people.length,unavailable,limit:100},fingerprint:hash({owner,people,unavailable})};
}
export function relevantPeople(context:ReturnType<typeof peopleContext>,sources:any[]){
 const text=sources.map(s=>[s.title,s.body,...(s.messages||[]).map((m:any)=>m.sender)].join('\n')).join('\n').toLocaleLowerCase();
 const related=context.people.filter(p=>p.aliases.some(a=>a.length>=2&&text.includes(a.toLocaleLowerCase()))||context.owner.aliases.some(a=>p.aliases.includes(a)));
 return {owner:context.owner,people:related.slice(0,16),coverage:{...context.coverage,matched:related.length,truncated:related.length>16}};
}
export function trackedPeopleContext(context:ReturnType<typeof peopleContext>,sources:any[]){
 const sourceMap=new Map(sources.map(s=>[s.id,s]));
 return list('memories').filter(m=>m.kind==='person_tracking'&&context.people.some(p=>p.id===m.personId)).map(m=>({personId:m.personId,observations:(m.observations||[]).filter((o:any)=>o.evidence.every((e:any)=>(()=>{const source=sourceMap.get(e.sourceId);if(!source)return false;if(e.messageId)return source.messages.some((m:any)=>m.id===e.messageId&&m.body.includes(e.quote)&&m.actor===e.actor&&m.sentAt===e.eventAt);return source.fingerprint===o.sourceFingerprints[e.sourceId]})())).slice(-20)}));
}
// Runs inside the analysis transaction. Dedupe by exact evidence, preserving edits/history.
export function savePersonObservations(updates:any[],context:ReturnType<typeof peopleContext>,sources:any[],runId:string){
 const fresh=new Map(sources.map(s=>[s.id,s]));
 for(const update of updates){
  const person=context.people.find(p=>p.id===update.personId)!;
  const id='tracking-'+person.id,old=get('memories',id,true);
  if(old&&!get('memories',id))continue; // A user's deletion is durable.
  const key=hash([update.kind,update.evidence]);
  if(old?.observations?.some((o:any)=>o.key===key))continue;
  const observations=[...(old?.observations||[]),{...update,key,runId,sourceFingerprints:Object.fromEntries(update.evidence.map((e:any)=>[e.sourceId,fresh.get(e.sourceId)?.fingerprint]))}];
  const automaticMarkdown=observations.map((o:any)=>`### ${o.eventAt||'时间待确认'} · ${o.kind}\n\n${o.summary}\n\n${o.evidence.map((e:any)=>`- 来源：${e.sourceId}${e.messageId?' / '+e.messageId:''}`).join('\n')}`).join('\n\n');
  if(old)put('person_tracking_history',{personId:person.id,previous:old,runId});
  const marker='<!-- cyberme-observations -->';
  const manual=String(old?.body||`# ${person.name} · 持续跟踪\n\n角色和管理关系以原人员 Wiki 的最新资料为准。\n`).split(marker)[0].trim();
  const body=manual+'\n\n'+marker+'\n\n'+automaticMarkdown;
  put('memories',{...old,id,title:person.name+' · 跟踪.md',kind:'person_tracking',personId:person.id,body,content:body,automaticMarkdown,observations,createdByRunId:old?.createdByRunId||runId});
 }
}
