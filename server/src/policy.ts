import {list,settings} from './store';

const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const minutes=(value:unknown)=>{const match=String(value).match(/^(\d{2}):(\d{2})$/);if(!match||Number(match[1])>23||Number(match[2])>59)return undefined;return Number(match[1])*60+Number(match[2]);};
export function workingWindow(config:any={},at=new Date()){
 if(!config.workingHoursOnly)return {allowed:true,reason:'unrestricted'};
 const from=minutes(config.workFrom??'08:00'),until=minutes(config.workUntil??'19:00');const selected=config.workDays??['Mon','Tue','Wed','Thu','Fri'];const timezone=config.timezone||'Asia/Singapore';
 if(from===undefined||until===undefined||from===until||!Array.isArray(selected)||selected.some((d:any)=>!days.includes(d)))return {allowed:false,reason:'invalid_working_hours'};
 let parts:Record<string,string>;try{parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));}catch{return {allowed:false,reason:'invalid_timezone'};}
 const time=Number(parts.hour)*60+Number(parts.minute),day=days.indexOf(parts.weekday);const startDay=from>until&&time<until?days[(day+6)%7]:parts.weekday;
 const inTime=from<until?time>=from&&time<until:time>=from||time<until;
 return {allowed:selected.includes(startDay)&&inTime,reason:selected.includes(startDay)&&inTime?'within_working_hours':'outside_working_hours',timezone,localDay:parts.weekday,localTime:`${parts.hour}:${parts.minute}`,startDay,from:config.workFrom??'08:00',until:config.workUntil??'19:00'};
}
export function draftPolicy(item:any,requested?:string){
 const wanted=requested||'auto';if(wanted==='chat'||wanted==='deep')return {mode:wanted,requestedMode:wanted,reasons:['explicit_selection']};
 if(item.triage?.status==='succeeded'&&item.triage.route==='deep_reply')return {mode:'deep',requestedMode:'auto',reasons:['jev_deep_reply']};
 const scopes=settings().autonomy.deepThink||[];const connection=list('connections').find(c=>c.status==='connected'&&(item.connectionId?c.id===item.connectionId:/^(Feishu|飞书)$/i.test(item.channel)?c.id==='feishu-local':String(c.provider).toLowerCase()===String(item.channel).toLowerCase()));
 const latestMessage=(item.messages||[]).slice().reverse().find((m:any)=>!m.isMine);const senderId=item.senderId||latestMessage?.senderId;const senderName=latestMessage?latestMessage.senderName:item.sender;
 const person=(connection?.config?.importantPeople||[]).find((p:any)=>p.sourceId?!!senderId&&p.sourceId===senderId:p.name&&String(p.name).trim()===String(senderName||'').trim());const role=String(person?.role||'').toLowerCase();const reasons:string[]=[];
 if(scopes.includes('everyone'))reasons.push('everyone');
 if(scopes.includes('vip')&&role==='vip')reasons.push('vip');
 if(scopes.includes('customers')&&['customer','client','客户'].includes(role))reasons.push('customers');
 if(scopes.includes('manager')&&['manager','主管'].includes(role))reasons.push('manager');
 if(scopes.includes('stakes')&&(item.sensitive||item.followup?.kind==='calendar'||item.dueDate||/(截止|到期|预算|付款|合同|报价|deadline|due\s+date|payment|budget|contract|[$¥￥€£]\s*\d|\d+(?:\.\d+)?\s*元|(?:USD|CNY|RMB|EUR)\s*\d)/i.test(`${item.title||''}\n${item.body||''}`)))reasons.push('stakes');
 return {mode:reasons.length?'deep':'chat',requestedMode:'auto',reasons:reasons.length?reasons:['no_matching_scope'],connectionId:connection?.id};
}
