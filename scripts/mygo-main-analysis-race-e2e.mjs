// Production HTTP + actual selected model. Public data only; no external sending.
import fs from 'node:fs/promises';import crypto from 'node:crypto';
const out='output/mygo-main-analysis-20261018/race-'+Date.now();await fs.mkdir(out,{recursive:true});const {token}=JSON.parse(await fs.readFile('.local/mygo-v17-public/connection.json'));
const api=async(method,path,body)=>{const r=await fetch('http://127.0.0.1:46510'+path,{method,headers:{'content-type':'application/json','X-OpsTwins-Pilot':token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {http:r.status,data:await r.json()}};
const id='public-race-'+crypto.randomUUID(),requestId='race-'+crypto.randomUUID(),checks=[];const check=(name,pass)=>{checks.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
try{
 const at=new Date().toISOString();check('创建独立公开事项',(await api('POST','/api/inbox',{id,title:'核对公开材料准备情况',sender:'公开同事',channel:'manual',origin:'human',status:'pending',receivedAt:at,body:'MINT-8421材料准备好了吗？请仅确认已知事实',messages:[{id:'race-source',body:'MINT-8421材料准备好了吗？请仅确认已知事实',isMine:false,sentAt:at}],context:['main-analysis-fact'],draft:'人工原稿 RACE-A',editedByUser:true})).http===201);
 const pending=api('POST','/api/inbox/'+id+'/draft',{requestId,mode:'chat'});
 let receipt;for(let n=0;n<150;n++){receipt=await api('GET','/api/inbox/'+id+'/draft-requests/'+requestId);if(receipt.http===200)break;await new Promise(r=>setTimeout(r,100))}
 check('实际模型请求先登记原ID',receipt.http===200&&receipt.data.status==='running');
 const item=(await api('GET','/api/inbox/'+id)).data;check('模型运行中人工输入保存',(await api('PATCH','/api/inbox/'+id,{draft:'人工后输入 RACE-B',editedByUser:true,baseUpdatedAt:item.updatedAt})).http===200);
 const result=await pending,after=(await api('GET','/api/inbox/'+id)).data;
 check('实际迟到模型只产生候选',result.http===409&&result.data.error==='draft_review_required'&&!!after.draftCandidate);
 check('人工后输入未被覆盖',after.draft==='人工后输入 RACE-B');
 const again=(await api('GET','/api/inbox/'+id+'/draft-requests/'+requestId)).data;check('原ID回查仍为同一个review',again.status==='review'&&again.runId===after.draftCandidate.runId);
 check('没有审批或外发',!after.approved&&!after.sentAt&&!after.receipt);
 await fs.writeFile(out+'/receipt.json',JSON.stringify({itemId:id,requestId,runId:again.runId,triageStatus:after.triage?.status,checks,scope:'actual deepseek-flash; real Jev402; explicit manual draft race; no private data'},null,2));console.log({out,checks});
}catch(e){await fs.writeFile(out+'/failure.json',JSON.stringify({checks,error:String(e)},null,2));throw e}
