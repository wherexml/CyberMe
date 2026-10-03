import type {Entity} from '../../../shared/types';

export function localized(value:any):string {
 if(value===undefined||value===null)return '';
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value);
 if(Array.isArray(value))return value.map(localized).filter(Boolean).join('\n');
 const language=value['zh-CN']??value.zh??value.zh_cn??value.en??value.en_us;
 return language!==undefined?localized(language):'';
}
export function sourceName(row:Entity):string {return localized(row.headline)||localized(row.title)||localized(row.subject)||localized(row.name)||localized(row.senderName)||localized(row.chatName)||row.id}
function section(title:string,values:any):string {const list=Array.isArray(values)?values:[values];const lines=list.map(localized).filter(Boolean);return lines.length?`## ${title}\n${lines.map(value=>`- ${value}`).join('\n')}`:''}
export function sourceContent(row:Entity):string {
 const person=row.person||row;
 if(row.sourceKind==='persons'||row.kind==='person'||person.openId&&person.organization){
  const events=(person.events||[]).map((event:any)=>[event.date,localized(event.title),localized(event.detail)].filter(Boolean).join('\n'));
  const portfolio=person.portfolio||{};
  return [`# ${sourceName(person)}`,['Role: '+localized(person.role),'Organization: '+localized(person.organization),'Relationship: '+localized(person.relationship)].filter(value=>!value.endsWith(': ')).join('\n'),localized(person.summary),section('Commitments',person.commitments),section('Events',events),section('Preferences',person.preferences),section('Current focus',portfolio.currentFocus),section('Strengths',portfolio.strengths),section('Risks',portfolio.risks),section('Communication',portfolio.communication)].filter(Boolean).join('\n\n');
 }
 if(row.sourceKind==='briefs'||row.kind==='brief'||row.metrics&&row.headline){
  const metrics=(row.metrics||[]).map((metric:any)=>`${localized(metric.label)}: ${localized(metric.value)}${localized(metric.note)?` · ${localized(metric.note)}`:''}`);
  const actions=(row.actions||[]).map((action:any)=>[localized(action.title),localized(action.detail),action.id?`Action ID: ${action.id}`:'',action.taskId?`Task ID: ${action.taskId}`:''].filter(Boolean).join('\n'));
  return [`# ${sourceName(row)}`,row.date?`Date: ${row.date}`:'',localized(row.summary),section('Metrics',metrics),section('Highlights',row.highlights),section('Risks',row.risks),section('Actions',actions),section('Recorded task IDs',row.metadata?.taskIds)].filter(Boolean).join('\n\n');
 }
 return localized(row.markdown)||localized(row.content)||localized(row.body)||localized(row.summary)||localized(row.text)||localized(row.preview)||'';
}
