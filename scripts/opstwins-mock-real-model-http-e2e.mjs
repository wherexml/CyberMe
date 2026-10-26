import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const dir='output/mock-real-chat-20261017/http-'+Date.now();mkdirSync(dir,{recursive:true});
const base='http://127.0.0.1:46400',clientId=randomUUID(),a='HISTORY-'+randomUUID().slice(0,8),b='QUOTE-'+randomUUID().slice(0,8),results=[];
const headers={'Content-Type':'application/json','Origin':base,'X-OpsTwins-Mock':'chat','X-OpsTwins-Client':clientId};
const check=(name,ok)=>{results.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name)};
const q={id:randomUUID(),type:'document',sourceId:'public-probe',sessionId:'main',sourceTitle:'公开引用核验',text:'引用代号是 '+b};
const id=randomUUID(),input={requestId:id,clientId,sessionId:'public-real-'+randomUUID(),history:[{role:'user',text:'请记住，项目暗号是 '+a,quotes:[]},{role:'assistant',text:'明白，我会结合这个项目暗号回答后续问题',quotes:[]}],question:'只输出前面对话的项目暗号和本次引用代号，用 / 分隔，不要解释',quotes:[q]};
let record;
try{
 let res=await fetch(base+'/api/mock-chat/requests/'+id,{method:'POST',headers,body:JSON.stringify(input)});check('真实模型请求先返回持久记录',[200,202].includes(res.status));
 const until=Date.now()+100000;while(Date.now()<until){res=await fetch(base+'/api/mock-chat/requests/'+id,{headers});record=await res.json();if(!['queued','running'].includes(record.status))break;await new Promise(r=>setTimeout(r,650))}
 check('真实上游成功返回且只调用一次',record.status==='succeeded'&&record.httpStatus===200&&record.upstreamCalls===1);
 check('真实模型同时消费历史和引用',record.text.includes(a)&&record.text.includes(b));
 res=await fetch(base+'/api/mock-chat/requests/'+id,{method:'POST',headers,body:JSON.stringify(input)});const duplicate=await res.json();check('同ID重复POST只回查不重放',duplicate.upstreamCalls===1&&duplicate.text===record.text);
 res=await fetch(base+'/api/mock-chat/requests/'+id,{method:'POST',headers,body:JSON.stringify({...input,question:'公开不同问题'})});check('同ID不同正文冲突',res.status===409);
 const nextId=randomUUID(),next={...input,requestId:nextId,history:[...input.history,{role:'user',text:input.question,quotes:input.quotes},{role:'assistant',text:record.text,quotes:[]}],question:'上一轮引用代号是什么？只输出该代号',quotes:[]};
 res=await fetch(base+'/api/mock-chat/requests/'+nextId,{method:'POST',headers,body:JSON.stringify(next)});const nextUntil=Date.now()+100000;let second;while(Date.now()<nextUntil){second=await (await fetch(base+'/api/mock-chat/requests/'+nextId,{headers})).json();if(!['queued','running'].includes(second.status))break;await new Promise(r=>setTimeout(r,650))}
 check('下一轮无新引用仍读取先前引用',second.status==='succeeded'&&second.text.includes(b)&&second.httpStatus===200&&second.upstreamCalls===1);
 res=await fetch(base+'/api/mock-chat/requests/'+id,{headers:{...headers,Origin:'https://example.com'}});check('跨站Origin被拒绝',res.status===403);
 res=await fetch(base+'/api/mock-chat/requests/'+id,{headers:{...headers,'X-OpsTwins-Client':randomUUID()}});check('其他客户端读不到原请求',res.status===404);
 const c=JSON.parse(readFileSync('.local/config.json','utf8')),secret=(c.llm||c).apiKey;check('公开结果没有服务端凭据',!JSON.stringify({record,second}).includes(secret));
 writeFileSync(dir+'/result.json',JSON.stringify({scope:'actual configured model; public random markers; no tools or business data',results,first:record,second,payloadSHA256:createHash('sha256').update(JSON.stringify(input)).digest('hex')},null,2));console.log({passed:results.length,dir});
}catch(e){writeFileSync(dir+'/failure.json',JSON.stringify({results,record,error:String(e)},null,2));console.log({dir,status:'FAIL',error:String(e),modelStatus:record?.status,httpStatus:record?.httpStatus});process.exitCode=1}
