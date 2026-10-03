// Native client (macOS/iOS) additions. Additive only: no existing route shape changes.
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db, get, publicValue, revision } from './store';
import { ApiError } from './integrations';

const json=(c:any,value:any,status=200)=>c.json(publicValue(value),status);

// One shared poller broadcasts revision changes to all SSE subscribers; it stops when nobody listens.
type Subscriber=(rev:number)=>void;
const subscribers=new Set<Subscriber>();
let poller:ReturnType<typeof setInterval>|undefined;let lastRevision=0;
function subscribe(fn:Subscriber){
 subscribers.add(fn);
 if(!poller){lastRevision=revision();poller=setInterval(()=>{let rev:number;try{rev=revision();}catch{return;}if(rev===lastRevision)return;lastRevision=rev;for(const s of [...subscribers]){try{s(rev);}catch{}}},500);poller.unref?.();}
 return ()=>{subscribers.delete(fn);if(!subscribers.size&&poller){clearInterval(poller);poller=undefined;}};
}
export function nativeSubscriberCount(){return subscribers.size;}

// Message page queries share one sort key; the partial expression index below matches it exactly.
const MSG_CONV="json_extract(data,'$.conversationId')";
const MSG_KEY="IFNULL(json_extract(data,'$.createdAt'),'')";
const MSG_SCOPE=`type='messages' AND deleted=0 AND ${MSG_CONV}=?`;
const stmts:Record<string,any>={};
const stmt=(k:string,sql:string)=>()=>stmts[k]??=db.prepare(sql);
const beforeStmt=stmt('before',`SELECT rowid AS r,${MSG_KEY} AS k FROM entities WHERE id=? AND ${MSG_SCOPE}`);
const pageLatestStmt=stmt('latest',`SELECT data FROM entities WHERE ${MSG_SCOPE} ORDER BY ${MSG_KEY} DESC, rowid DESC LIMIT ?`);
const pageBeforeStmt=stmt('page',`SELECT data FROM entities WHERE ${MSG_SCOPE} AND (${MSG_KEY}<? OR (${MSG_KEY}=? AND rowid<?)) ORDER BY ${MSG_KEY} DESC, rowid DESC LIMIT ?`);
function ensureMessageIndex(){
 // Additive and idempotent: entities schema (store.ts) is untouched; failure only costs speed, never correctness.
 try{db.exec(`CREATE INDEX IF NOT EXISTS native_messages_conv_created ON entities(${MSG_CONV},${MSG_KEY}) WHERE type='messages' AND deleted=0`);}
 catch(e){console.warn('[native-api] message index unavailable:',(e as Error).message);}
}

export function mountNativeApi(app:Hono){
 ensureMessageIndex();
 app.get('/api/native/version',c=>json(c,{apiVersion:1,revision:revision(),server:'opstwin-advance',features:['messages.page','events.sse']}));

 app.get('/api/conversations/:id/messages',c=>{
  const conversationId=c.req.param('id');
  if(!get('conversations',conversationId))throw new ApiError(404,'not_found','会话不存在');
  const rawLimit=c.req.query('limit');const limit=rawLimit===undefined?50:Number(rawLimit);
  if(!/^\d+$/.test(rawLimit??'50')||!Number.isInteger(limit)||limit<1||limit>200)throw new ApiError(400,'invalid_pagination','limit 必须是 1–200 的整数');
  // Chronological order: createdAt, then insertion rowid as a stable tie-breaker. Keyset paging walks
  // newest→oldest with LIMIT limit+1 so a page never loads or parses the whole conversation.
  const before=c.req.query('before');let rows:any[];
  if(before!==undefined){
   const anchor=beforeStmt().get(before,conversationId) as any;
   if(!anchor)throw new ApiError(400,'invalid_before','before 不是该会话中的消息 ID');
   rows=pageBeforeStmt().all(conversationId,anchor.k,anchor.k,anchor.r,limit+1) as any[];
  }else rows=pageLatestStmt().all(conversationId,limit+1) as any[];
  const hasMore=rows.length>limit;const items=rows.slice(0,limit).reverse().map(row=>JSON.parse(row.data));
  return json(c,{items,hasMore,nextBefore:hasMore&&items.length?items[0].id:null});
 });

 app.get('/api/native/events',c=>{
  c.header('Cache-Control','no-store');c.header('X-Accel-Buffering','no');
  const lastEventId=Number(c.req.header('last-event-id'));
  return streamSSE(c,async stream=>{
   let sent=revision();let closed=false;let done=false;let pending:Promise<unknown>=Promise.resolve();
   const send=(fn:()=>Promise<unknown>)=>{pending=pending.then(()=>closed?undefined:fn()).catch(()=>{closed=true;});return pending;};
   await stream.writeSSE({event:'hello',id:String(sent),data:JSON.stringify({revision:sent})});
   if(Number.isFinite(lastEventId)&&c.req.header('last-event-id')!==undefined&&sent>lastEventId)await stream.writeSSE({event:'revision',id:String(sent),data:JSON.stringify({revision:sent})});
   await new Promise<void>(resolve=>{
    const unsubscribe=subscribe(rev=>{if(rev<=sent)return;sent=rev;send(()=>stream.writeSSE({event:'revision',id:String(rev),data:JSON.stringify({revision:rev})}));});
    const watchdog=setInterval(()=>{if(closed||stream.aborted||stream.closed)finish();},1000);watchdog.unref?.();
    const ping=setInterval(()=>{send(()=>stream.write(': ping\n\n'));},15000);ping.unref?.();
    const finish=()=>{if(done)return;done=true;closed=true;clearInterval(watchdog);clearInterval(ping);unsubscribe();resolve();};
    stream.onAbort(finish);c.req.raw.signal?.addEventListener('abort',finish,{once:true});

   });
  },async(err,stream)=>{try{await stream.writeSSE({event:'error',data:JSON.stringify({error:'stream_failed'})});}catch{}});
 });
}
