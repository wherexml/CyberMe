import {get,list,put,uid,db} from './store';
import {generateInboxDraft} from './drafts';

// One durable preparation per empty pending item. Failures/unknown outcomes
// require explicit regeneration; no automatic send and no restart replay.
function eligible(item:any) {
 return item.status==='pending' && !String(item.draft||'').trim() && !item.editedByUser
  && !item.draftCandidate && !item.draftError
  && !['queued','pending','running','interrupted','review'].includes(item.sourceProcessing?.status);
}
function activeRequest(itemId:string) {
 return (db.prepare("SELECT data FROM draft_requests WHERE state='running'").all() as any[])
  .some(row=>JSON.parse(row.data).itemId===itemId);
}
let working=false;
export async function prepareDefaultDrafts() {
 if(working)return;
 working=true;
 try {
  for(const item of list('inbox')) {
   if(item.draftPreparation?.status==='queued'&&!eligible(item)) {
    put('inbox',{...item,draftPreparation:{...item.draftPreparation,status:'skipped'}});
    continue;
   }
   if(eligible(item)&&!item.draftPreparation&&!activeRequest(item.id))
    put('inbox',{...item,draftPreparation:{requestId:uid('default-draft'),status:'queued'}});
  }
  const item=list('inbox').find(row=>eligible(row)&&row.draftPreparation?.status==='queued'&&!activeRequest(row.id));
  if(!item)return;
  const requestId=item.draftPreparation.requestId;
  const publish=(status:string,code?:string)=>{
   const latest=get('inbox',item.id);
   if(latest?.draftPreparation?.requestId===requestId)
    put('inbox',{...latest,draftPreparation:{requestId,status,...(code?{code}:{})}});
  };
  publish('running');
  try {
   await generateInboxDraft(item.id,{mode:'auto',requestId},()=>{
    const latest=get('inbox',item.id);
    return latest?.draftPreparation?.requestId===requestId&&eligible(latest);
   },{background:true});
   publish('succeeded');
  } catch(error:any) {
   publish(error?.code==='draft_review_required'?'review':'failed',String(error?.code||'generation_failed'));
  }
 } finally {working=false;}
}
export function startDefaultDrafts() {
 for(const item of list('inbox'))if(item.draftPreparation?.status==='running')
  put('inbox',{...item,draftPreparation:{...item.draftPreparation,status:'unknown',code:'server_interrupted'}});
 const timer=setInterval(()=>void prepareDefaultDrafts().catch(()=>{}),3000);
 timer.unref();
 return timer;
}
