import sharp from 'sharp';
import type {Entity, Task} from '../../shared/types';

export type OperationsVisualKind = 'chart' | 'timeline' | 'diagram';
export interface OperationsVisualInput {
  kind: OperationsVisualKind;
  title: string;
  /** The caller supplies real, already scoped, persisted records. */
  tasks: readonly Task[];
  projects: readonly Entity[];
  /** Provenance only; this renderer never invents records for an ID. */
  sourceIds: readonly string[];
}
const WIDTH=1200, MAX_ROWS=12;
const colors={text:'#1D1D1F',muted:'#6E6E73',border:'#E5E5EA',bg:'#F5F5F7',blue:'#0071E3',purple:'#5E5CE6',green:'#34C759',orange:'#C77800'};
const segmenter=new Intl.Segmenter('en',{granularity:'grapheme'});
function safeString(value:unknown):string{return value===null||value===undefined?'':String(value);}
function xml(value:unknown):string{
  const clean=Array.from(safeString(value)).map(char=>{const n=char.codePointAt(0)!;return n===9||n===10||n===13||(n>=32&&n<=0xD7FF)||(n>=0xE000&&n<=0xFFFD)||(n>=0x10000&&n<=0x10FFFF)?char:'\uFFFD';}).join('');
  return clean.replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]!));
}
function units(grapheme:string){return /[\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]|\p{Extended_Pictographic}/u.test(grapheme)?2:1;}
/** Grapheme-safe wrapping keeps Chinese and emoji inside their SVG columns. */
function wrap(value:unknown,maxUnits:number,maxLines=2):string[]{
  const text=safeString(value).replace(/\s+/gu,' ').trim();const parts=Array.from(segmenter.segment(text),part=>part.segment);const lines:string[]=[];let line='',width=0;
  for(let i=0;i<parts.length;i++){const part=parts[i],size=units(part);if(width+size>maxUnits){lines.push(line.trim());line='';width=0;if(lines.length===maxLines){const last=Array.from(segmenter.segment(lines[maxLines-1]),p=>p.segment);while(last.length&&last.reduce((n,p)=>n+units(p),0)>maxUnits-1)last.pop();lines[maxLines-1]=last.join('')+'…';return lines;}}line+=part;width+=size;}
  if(line||!lines.length)lines.push(line.trim());return lines;
}
function text(x:number,y:number,value:unknown,size=16,color=colors.text,weight=400,anchor='start'){
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${xml(value)}</text>`;
}
function multiline(x:number,y:number,value:unknown,maxUnits:number,size=16,color=colors.text,maxLines=2){return wrap(value,maxUnits,maxLines).map((line,i)=>text(x,y+i*(size+6),line,size,color)).join('');}
function frame(title:string,subtitle:string,body:string,height:number,notes:string[],sourceIds:readonly string[]){
  const titleLines=wrap(title||'Operations data',67,2);
  const heading=titleLines.map((line,i)=>text(48,74+i*38,line,30,colors.text,700)).join('');
  const footer=[...notes,`Source: persisted OpsTwin Advance records · ${sourceIds.length} explicit source IDs. Long labels wrap or truncate; row data preserves originals.`];
  const footerLines=footer.flatMap(note=>wrap(note,142,2));
  const footerStart=height-32-(footerLines.length-1)*19;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${xml(title)}"><rect width="${WIDTH}" height="${height}" fill="${colors.bg}"/><rect x="24" y="24" width="${WIDTH-48}" height="${height-48}" rx="22" fill="#FFFFFF"/><g font-family="Arial Unicode MS,Arial,sans-serif">${heading}${text(48,titleLines.length>1?139:111,subtitle,14,colors.muted)}${body}${footerLines.map((line,i)=>text(48,footerStart+i*19,line,12,colors.muted)).join('')}</g></svg>`;
}
function baseY(title:string){return wrap(title||'Operations data',67,2).length>1?186:154;}
function imageHeight(bodyBottom:number,notes:string[]){const n=notes.flatMap(note=>wrap(note,142,2)).length+2;return Math.max(430,bodyBottom+60+n*19);}
function dateValue(raw:unknown):{raw:string;ms:number;day:string}|null{
  const value=safeString(raw).trim();
  if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/.test(value))return null;
  const [year,month,day]=value.slice(0,10).split('-').map(Number);const calendar=new Date(0);calendar.setUTCFullYear(year,month-1,day);calendar.setUTCHours(0,0,0,0);
  if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day)return null;
  const ms=Date.parse(value);if(!Number.isFinite(ms))return null;return {raw:value,ms,day:new Date(ms).toISOString().slice(0,10)};
}
function recordedStatus(task:Task){return safeString(task.status).trim()||'Unspecified';}
function activeRecords<T extends Entity>(values:readonly T[]):T[]{return values.filter(value=>value&&!value.deletedAt&&!value.deleted);}
function emptyBody(y:number,message:string){return `<rect x="48" y="${y}" width="1104" height="140" rx="14" fill="${colors.bg}"/>${text(72,y+58,'No persisted records',23,colors.text,600)}${text(72,y+94,message,16,colors.muted)}`;}

function chart(input:OperationsVisualInput,tasks:Task[]){
  const counts=new Map<string,number>();tasks.forEach(task=>counts.set(recordedStatus(task),(counts.get(recordedStatus(task))||0)+1));
  const sorted=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  let rows:any[]=sorted.map(([status,count])=>({status,count}));const notes:string[]=[];
  if(rows.length>MAX_ROWS){const rest=rows.slice(MAX_ROWS-1);rows=[...rows.slice(0,MAX_ROWS-1),{status:`Other ${rest.length} statuses`,count:rest.reduce((n,row)=>n+row.count,0),summary:true,statuses:rest}];notes.push(`${sorted.length} recorded statuses are aggregated into ${MAX_ROWS} rows; all ${tasks.length} tasks remain included in the counts.`);}
  else if(tasks.length>MAX_ROWS)notes.push(`Summary of all ${tasks.length} persisted tasks, grouped by their recorded status; individual task detail is not shown.`);
  const start=baseY(input.title),rowHeight=62,max=Math.max(1,...rows.map(row=>row.count));
  const body=rows.length?rows.map((row,i)=>{const y=start+i*rowHeight;return multiline(56,y+25,row.status,28,16,colors.text,2)+`<rect x="340" y="${y+6}" width="700" height="32" rx="6" fill="${colors.bg}"/><rect x="340" y="${y+6}" width="${Math.round(row.count/max*700)}" height="32" rx="6" fill="${[colors.blue,colors.purple,colors.green,colors.orange][i%4]}"/>`+text(1120,y+29,row.count,18,colors.text,600,'end');}).join(''):emptyBody(start,'There are no task records to count. No values were inferred.');
  return {rows,svg:frame(input.title,`Task status counts · ${tasks.length} persisted tasks`,body,imageHeight(start+Math.max(1,rows.length)*rowHeight+(rows.length?0:90),notes),notes,input.sourceIds)};
}

function timeline(input:OperationsVisualInput,tasks:Task[]){
  const records=tasks.map(task=>({task,created:dateValue(task.createdAt),due:dateValue(task.dueDate)}));
  const missingCreated=records.filter(row=>!safeString(row.task.createdAt).trim()).length,invalidCreated=records.filter(row=>safeString(row.task.createdAt).trim()&&!row.created).length;
  const missingDue=records.filter(row=>!safeString(row.task.dueDate).trim()).length,invalidDue=records.filter(row=>safeString(row.task.dueDate).trim()&&!row.due).length;
  const notes=[`Recorded dates use UTC calendar days. Missing created: ${missingCreated}; invalid created: ${invalidCreated}; missing due: ${missingDue}; invalid due: ${invalidDue}. No dates are inferred.`];
  const start=baseY(input.title);let body='',rows:any[]=[],bottom=start+150,subtitle=`Recorded creation and due dates · ${tasks.length} persisted tasks`;
  if(!tasks.length)body=emptyBody(start,'No task creation or due dates are available.');
  else if(tasks.length>MAX_ROWS){
    const events=records.flatMap(row=>[...(row.created?[{date:row.created.day,type:'created',taskId:row.task.id}]:[]),...(row.due?[{date:row.due.day,type:'due',taskId:row.task.id}]:[])]);
    let granularity:'day'|'month'|'year'='day';const keyFor=(date:string)=>granularity==='day'?date:granularity==='month'?date.slice(0,7):date.slice(0,4);
    const grouped=()=>{const map=new Map<string,any>();for(const event of events){const key=keyFor(event.date),row=map.get(key)||{date:key,createdCount:0,dueCount:0,createdTaskIds:[],dueTaskIds:[],summary:true};if(event.type==='created'){row.createdCount++;row.createdTaskIds.push(event.taskId);}else{row.dueCount++;row.dueTaskIds.push(event.taskId);}map.set(key,row);}return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));};
    rows=grouped();if(rows.length>MAX_ROWS){granularity='month';rows=grouped();}if(rows.length>MAX_ROWS){granularity='year';rows=grouped();}
    if(rows.length>MAX_ROWS){const remainder=rows.slice(MAX_ROWS-1);rows=[...rows.slice(0,MAX_ROWS-1),{date:`Other ${remainder.length} recorded years`,createdCount:remainder.reduce((n,row)=>n+row.createdCount,0),dueCount:remainder.reduce((n,row)=>n+row.dueCount,0),summary:true,buckets:remainder}];}
    notes.unshift(`More than ${MAX_ROWS} tasks: this is a ${granularity}-level summary of actual created/due events, not a fabricated schedule. ${events.length} dated events are represented.`);
    subtitle=`Recorded timeline · ${tasks.length} tasks · ${granularity}-level summary`;
    const max=Math.max(1,...rows.flatMap(row=>[row.createdCount,row.dueCount]));
    body=rows.length?text(340,start-4,'Created',13,colors.blue,600)+text(760,start-4,'Due',13,colors.purple,600)+rows.map((row,i)=>{const y=start+20+i*70;return multiline(56,y+25,row.date,28,16,colors.text,2)+`<rect x="340" y="${y+4}" width="${Math.round(row.createdCount/max*320)}" height="25" rx="5" fill="${colors.blue}"/>`+text(686,y+23,row.createdCount,16,colors.text,600,'end')+`<rect x="760" y="${y+4}" width="${Math.round(row.dueCount/max*320)}" height="25" rx="5" fill="${colors.purple}"/>`+text(1120,y+23,row.dueCount,16,colors.text,600,'end');}).join(''):emptyBody(start,'Tasks exist, but none contain valid recorded dates.');
    bottom=start+20+Math.max(1,rows.length)*70+(rows.length?0:70);
  }else{
    records.sort((a,b)=>(a.due?.ms??a.created?.ms??Infinity)-(b.due?.ms??b.created?.ms??Infinity)||a.task.id.localeCompare(b.task.id));
    rows=records.map(row=>({taskId:row.task.id,title:row.task.title,status:recordedStatus(row.task),projectId:row.task.projectId||null,createdAt:row.task.createdAt||null,dueDate:row.task.dueDate||null,createdTimestamp:row.created?.ms??null,dueTimestamp:row.due?.ms??null,deadlineBeforeCreation:!!(row.created&&row.due&&row.due.ms<row.created.ms)}));
    const timestamps=records.flatMap(row=>[...(row.created?[row.created.ms]:[]),...(row.due?[row.due.ms]:[])]);const min=Math.min(...timestamps),max=Math.max(...timestamps);
    const position=(ms:number)=>max===min?820:490+(ms-min)/(max-min)*590;
    if(timestamps.length)body+=text(490,start-6,new Date(min).toISOString().slice(0,10),13,colors.muted)+text(1080,start-6,new Date(max).toISOString().slice(0,10),13,colors.muted,400,'end');
    body+=records.map((row,i)=>{const y=start+18+i*92;let draw=`<line x1="490" y1="${y+19}" x2="1080" y2="${y+19}" stroke="${colors.border}" stroke-dasharray="4 5"/>`;if(row.created&&row.due)draw+=`<line x1="${position(row.created.ms)}" y1="${y+19}" x2="${position(row.due.ms)}" y2="${y+19}" stroke="${row.due.ms<row.created.ms?colors.orange:colors.blue}" stroke-width="5"/>`;if(row.created)draw+=`<circle cx="${position(row.created.ms)}" cy="${y+19}" r="6" fill="${colors.blue}"/>`;if(row.due){const x=position(row.due.ms);draw+=`<path d="M ${x} ${y+11} l 8 8 l -8 8 l -8 -8 z" fill="${colors.purple}"/>`;}return multiline(56,y+18,row.task.title||'[Untitled task]',39,16,colors.text,2)+text(56,y+64,wrap(`${recordedStatus(row.task)} · ${row.task.id}`,47,1)[0],12,colors.muted)+draw+text(490,y+64,`Created: ${row.created?.day||(row.task.createdAt?'invalid':'not recorded')} · Due: ${row.due?.day||(row.task.dueDate?'invalid':'not set')}`,12,colors.muted);}).join('');
    if(rows.some(row=>row.deadlineBeforeCreation))notes.push('Some due dates precede recorded creation dates; those spans are orange and remain as recorded.');
    notes.push('Blue circle = creation; purple diamond = due. A missing endpoint is not drawn.');bottom=start+18+records.length*92;
  }
  return {rows,svg:frame(input.title,subtitle,body,imageHeight(bottom,notes),notes,input.sourceIds)};
}

function diagram(input:OperationsVisualInput,tasks:Task[],projects:Entity[]){
  const projectById=new Map(projects.map(project=>[project.id,project]));const groups=new Map<string|symbol,any>();const unassignedKey=Symbol('unassigned');
  for(const project of projects)groups.set(project.id,{projectId:project.id,projectTitle:safeString(project.title||project.name)||'[Untitled project]',projectExists:true,tasks:[]});
  for(const task of tasks){const key=task.projectId||unassignedKey;if(!groups.has(key))groups.set(key,{projectId:task.projectId||null,projectTitle:task.projectId?`Unknown project ${task.projectId}`:'No project assigned',projectExists:!!task.projectId&&projectById.has(task.projectId),tasks:[]});groups.get(key).tasks.push(task);}
  const ordered=[...groups.values()].sort((a,b)=>safeString(a.projectTitle).localeCompare(safeString(b.projectTitle)));const missing=tasks.filter(task=>task.projectId&&!projectById.has(task.projectId)).length,unassigned=tasks.filter(task=>!task.projectId).length;
  const detailCount=ordered.reduce((n,group)=>n+Math.max(1,group.tasks.length),0);const summarize=tasks.length>MAX_ROWS||detailCount>MAX_ROWS;const notes=[`Only stored projectId relationships are drawn. Unassigned tasks: ${unassigned}; task references to unavailable projects: ${missing}.`];
  let rows:any[]=[],body='',cursor=baseY(input.title),subtitle=`Project → task relationships · ${projects.length} projects · ${tasks.length} tasks`;
  if(!ordered.length)body=emptyBody(cursor,'There are no project or task records to draw.');
  else if(summarize){
    rows=ordered.map(group=>{const statuses:Record<string,number>=Object.create(null);for(const task of group.tasks)statuses[recordedStatus(task)]=(statuses[recordedStatus(task)]||0)+1;return {projectId:group.projectId,projectTitle:group.projectTitle,projectExists:group.projectExists,taskCount:group.tasks.length,taskIds:group.tasks.map((task:Task)=>task.id),statusCounts:statuses,summary:true};});
    if(rows.length>MAX_ROWS){const other=rows.slice(MAX_ROWS-1);rows=[...rows.slice(0,MAX_ROWS-1),{projectId:null,projectTitle:`Other ${other.length} project groups`,projectExists:false,taskCount:other.reduce((n,row)=>n+row.taskCount,0),groups:other,summary:true}];}
    notes.unshift(`More than ${MAX_ROWS} detail rows: project-level task counts are summarized into ${rows.length} rows. No implied new project or task was created.`);
    subtitle+=' · project-level summary';
    body=rows.map((row,i)=>{const y=cursor+i*112;const statusText=row.groups?'Separate project groups; see artifact row data':Object.entries(row.statusCounts).map(([status,count])=>`${status}: ${count}`).join(' · ')||'No tasks linked';return `<rect x="48" y="${y}" width="410" height="82" rx="12" fill="${colors.bg}" stroke="${colors.border}"${row.projectExists?'':' stroke-dasharray="5 4"'}/>`+multiline(68,y+30,row.projectTitle,41,17,colors.text,2)+`<path d="M458 ${y+41} H548" stroke="${colors.purple}" stroke-width="2"/><path d="M548 ${y+41} l-8 -5 v10 z" fill="${colors.purple}"/><rect x="560" y="${y}" width="592" height="82" rx="12" fill="#EEEEFD"/>`+text(580,y+29,`${row.taskCount} persisted task${row.taskCount===1?'':'s'}`,17,colors.text,600)+multiline(580,y+56,statusText,65,13,colors.muted,1);}).join('');cursor+=rows.length*112;
  }else{
    for(const group of ordered){const count=Math.max(1,group.tasks.length),groupHeight=count*94+18,center=cursor+(count-1)*47+39;body+=`<rect x="48" y="${center-39}" width="410" height="78" rx="12" fill="${colors.bg}" stroke="${colors.border}"${group.projectExists?'':' stroke-dasharray="5 4"'}/>`+multiline(68,center-8,group.projectTitle,41,17,colors.text,2);if(!group.tasks.length){body+=text(580,center+5,'No tasks linked to this project',16,colors.muted);rows.push({projectId:group.projectId,projectTitle:group.projectTitle,taskIds:[],taskCount:0});}else{body+=`<path d="M458 ${center} H520" stroke="${colors.purple}" stroke-width="2"/>`;for(let i=0;i<group.tasks.length;i++){const task:Task=group.tasks[i],y=cursor+i*94;body+=`<path d="M520 ${center} V${y+39} H548" fill="none" stroke="${colors.purple}" stroke-width="2"/><path d="M548 ${y+39} l-8 -5 v10 z" fill="${colors.purple}"/><rect x="560" y="${y}" width="592" height="78" rx="12" fill="#EEEEFD"/>`+multiline(580,y+27,task.title||'[Untitled task]',63,16,colors.text,2)+text(580,y+65,wrap(`${recordedStatus(task)} · ${task.id}`,74,1)[0],12,colors.muted);rows.push({projectId:group.projectId,projectTitle:group.projectTitle,projectExists:group.projectExists,taskId:task.id,title:task.title,status:recordedStatus(task)});}}cursor+=groupHeight;}
  }
  return {rows,svg:frame(input.title,subtitle,body,imageHeight(cursor+(!ordered.length?150:0),notes),notes,input.sourceIds)};
}

/** Standard data visualization: SVG layout followed by deterministic PNG rasterization. */
export async function renderOperationsVisual(input:OperationsVisualInput):Promise<{bytes:Buffer;rows:any[];kind:string}>{
  if(!['chart','timeline','diagram'].includes(input.kind))throw new Error('Unsupported operations visualization kind');
  const tasks=activeRecords(input.tasks||[]),projects=activeRecords(input.projects||[]);const normalized={...input,title:safeString(input.title),sourceIds:Array.isArray(input.sourceIds)?input.sourceIds:[]};
  const rendered=input.kind==='chart'?chart(normalized,tasks):input.kind==='timeline'?timeline(normalized,tasks):diagram(normalized,tasks,projects);
  const bytes=await sharp(Buffer.from(rendered.svg)).png().toBuffer();return {bytes,rows:rendered.rows,kind:input.kind};
}
