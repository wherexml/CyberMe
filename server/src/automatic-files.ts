import {db,get,list,put,meta,setMeta,now,hash} from './store';

const lockedStates=new Set(['sending','sent','recalled','send_unknown']);

/** Retire only automatic output associations; preserve file bytes and outbound history. */
function withoutAutomaticFiles(item:any){
 if(!item||lockedStates.has(item.status))return item;
 const automaticIds=new Set<string>(item.automaticFiles?.artifactIds||[]);
 const isAutomatic=(id:string)=>{const artifact=get('artifacts',id);return automaticIds.has(id)||!!(artifact?.automaticRequestId&&artifact.sourceInboxId===item.id);};
 const candidate=item.draftCandidate;
 if(!item.automaticFiles&&!candidate?.automaticFiles&&![...(item.attachments||[]),...(item.artifactIds||[]),...(candidate?.artifactIds||[])].some(isAutomatic))return item;
 const {automaticFiles,...rest}=item;
 const attachments=(item.attachments||[]).filter((id:string)=>!isAutomatic(id));
 const artifactIds=(item.artifactIds||[]).filter((id:string)=>!isAutomatic(id));
 let draftCandidate=item.draftCandidate;
 if(draftCandidate){
  const candidateIds=new Set<string>(draftCandidate.automaticFiles?.artifactIds||[]);
  const {automaticFiles,...candidate}=draftCandidate;
  draftCandidate={...candidate,artifactIds:(candidate.artifactIds||[]).filter((id:string)=>!candidateIds.has(id)&&!isAutomatic(id))};
 }
 const changed=attachments.length!==(item.attachments||[]).length;
 return {...rest,...(item.attachments?{attachments}:{}),...(item.artifactIds?{artifactIds}:{}),...(draftCandidate?{draftCandidate}:{}),...(changed?{approved:false,sensitiveApproved:false}:{})};
}

/** Atomic, one-time local migration; no source database or artifact is deleted. */
export function migrateAutomaticReplyFiles(){
 const key='automatic-reply-files-removed-v1';if(meta(key,false))return;
 db.exec('BEGIN IMMEDIATE');
 try{
  const sourceHash=(item:any)=>hash({title:item.title,body:item.body,draft:item.draft,attachments:item.attachments||[],...(item.sourceAttachments?.length?{sourceAttachments:item.sourceAttachments}:{}),sender:item.sender,channel:item.channel,sensitive:item.sensitive});
  const changedSources=new Map<string,{before:string;after:string}>();
  for(const item of list('inbox')){
   const cleaned=withoutAutomaticFiles(item);
   if(JSON.stringify(cleaned)!==JSON.stringify(item)){changedSources.set(item.id,{before:sourceHash(item),after:sourceHash(cleaned)});put('inbox',cleaned);}
  }
  for(const row of db.prepare('SELECT id,data FROM draft_requests').all() as any[]){
   const original=JSON.parse(row.data);
   if(lockedStates.has(get('inbox',original.itemId)?.status))continue;
   const {filePlan,...intent}=original;
   const source=changedSources.get(intent.itemId);
   if(source&&intent.sourceHash===source.before)intent.sourceHash=source.after;
   if(intent.result&&!lockedStates.has(intent.result.item?.status)){
    const {automaticFiles,...result}=intent.result;
    intent.result={...result,item:withoutAutomaticFiles(result.item),artifacts:(result.artifacts||[]).filter((a:any)=>!a.automaticRequestId&&!get('artifacts',a.id)?.automaticRequestId)};
   }
   if(JSON.stringify(intent)!==JSON.stringify(original))db.prepare('UPDATE draft_requests SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(intent),now(),row.id);
  }
  setMeta(key,true);db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
