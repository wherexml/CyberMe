// Re-run current local failures through the installed HTTP API; never send replies.
import fs from'node:fs/promises';
const base='http://127.0.0.1:46110/api',out='output/mygo-analysis-recovery-20261019',observations=[];
const api=async(p,body)=>{const r=await fetch(base+p,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});return {http:r.status,data:await r.json()}};
const items=async()=>{const{data}=await api('/inbox');return Array.isArray(data)?data:data.items};
const counts=rows=>rows.reduce((a,i)=>{const k=i.triage?.status||'pending';a[k]=(a[k]||0)+1;return a},{});
const errorCode=t=>/HTTP 400/.test(t?.error||'')?'jev_http_400':/上下文过长/.test(t?.error||'')?'context_too_long':/HTTP 402|额度/.test(t?.error||'')?'credits':t?.error?'other_error':undefined;
const attempted=new Set();let completed=0;
for(let round=0;round<3;round++){
 const rows=await items(),queue=rows.filter(i=>(i.sourceSystem==='wechat-sync'||i.triage?.status==='failed')&&!i.sourceUnavailable&&!i.sourceAttentionExcluded&&i.triage?.status!=='running'&&i.triage?.status!=='succeeded'&&!attempted.has(i.id));if(!queue.length)break;
 let cursor=0;await Promise.all(Array.from({length:1},async()=>{while(cursor<queue.length){const item=queue[cursor++];attempted.add(item.id);try{const result=await api('/inbox/'+encodeURIComponent(item.id)+'/triage',{force:true});observations.push({http:result.http,status:result.data.status,model:result.data.model,errorCode:errorCode(result.data)});completed++;if(completed%10===0)console.log(JSON.stringify({completed,queued:queue.length}));}catch{observations.push({status:'unknown',errorCode:'http_unconfirmed'})}}}));
}
const all=await items(),wechat=all.filter(i=>i.sourceSystem==='wechat-sync'),report={at:new Date().toISOString(),attempts:observations,all:counts(all),wechat:counts(wechat.filter(i=>!i.sourceAttentionExcluded)),wechatCount:wechat.length,excludedGroups:wechat.filter(i=>i.sourceAttentionExcluded).length,errorCounts:all.filter(i=>!i.sourceAttentionExcluded&&i.triage?.status==='failed').reduce((a,i)=>{const k=errorCode(i.triage);a[k]=(a[k]||0)+1;return a},{}),privateContentsSaved:false};await fs.writeFile(out+'/installed-recovery.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,attempts:observations.length}));
