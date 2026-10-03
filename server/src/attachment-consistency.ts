import {get} from './store';

/** Conservative check for explicit file-state contradictions, not a general semantic proof. */
export function attachmentContradiction(item:any,draft=String(item.draft||'')):string|null{
 if(!item.automaticFiles)return null;
 const files=(item.attachments||[]).map((id:string)=>get('artifacts',id)).filter(Boolean);
 const cases=[{kind:'pdf',noun:'pdf|report|报告|摘要',present:files.some((a:any)=>a.kind==='pdf'||a.mime==='application/pdf')},{kind:'chart',noun:'chart|graph|diagram|图表',present:files.some((a:any)=>a.kind==='chart'||a.kind==='diagram'||a.kind==='timeline')}];
 for(const {kind,noun,present} of cases){
  const denied=new RegExp(`(?:have not|haven't|did not|didn't|not)\\s+(?:prepared|created|generated|attached)[^.!?。！？\\n]{0,60}(?:${noun})|(?:未|没有|尚未)(?:准备|制作|生成|附上)[^。！？\\n]{0,20}(?:${noun})`,'i').test(draft);
  const promisedAttached=new RegExp(`(?:please (?:find|see) (?:the )?attached|attached (?:is|are|the)|随附|已附上)[^.!?。！？\\n]{0,40}(?:${noun})`,'i').test(draft);
  if(present&&denied)return `The draft says the ${kind} was not prepared, but it is attached. Edit the reply before approving.`;
  if(!present&&promisedAttached)return `The draft refers to an attached ${kind}, but no such file is attached. Edit the reply or add the file before approving.`;
 }
 return null;
}
