// Additive read-only native search. See failure matrix before implementation.
import type {Hono} from 'hono';
import {db,publicValue,revision} from './store';
import {ApiError} from './integrations';

export const WORKSPACE_SEARCH_KINDS=['messages','conversations','inbox','ideas','tasks','artifacts','projects','memories','automations','activities'] as const;
type Kind=typeof WORKSPACE_SEARCH_KINDS[number];
const kinds=new Set<string>(WORKSPACE_SEARCH_KINDS);
const textField=(field:string)=>`CASE WHEN json_type(data,'$.${field}')='text' THEN json_extract(data,'$.${field}') ELSE '' END`;
const fields=['title','name','sender','senderName','body','content','description','notes','prompt','summary','markdown','text','draft','detail'];
const messageFields=['text','content','body','senderName'];
const stepFields=['title','description','text','content','notes'];
const nested=(field:string,keys:string[])=>`COALESCE((SELECT group_concat(CASE WHEN nested.type='text' THEN nested.value WHEN nested.type='object' THEN ${keys.map(key=>`CASE WHEN json_type(nested.value,'$.${key}')='text' THEN json_extract(nested.value,'$.${key}') ELSE '' END`).join("||char(10)||")} ELSE '' END,char(10)) FROM json_each(CASE WHEN json_type(data,'$.${field}')='array' THEN json_extract(data,'$.${field}') ELSE '[]' END) nested),'')`;
const searchText=[...fields.map(textField),nested('messages',messageFields),nested('steps',stepFields)].join('||char(10)||');
const title=`COALESCE(NULLIF(${textField('title')},''),NULLIF(${textField('name')},''),NULLIF(${textField('sender')},''),'')`;
const timeSql=`native_search_time(${textField('createdAt')},${textField('updatedAt')})`;
const cte=`WITH records AS (SELECT type AS kind,id,${title} AS title,CASE WHEN type='messages' THEN COALESCE(NULLIF(${textField('conversationId')},''),id) ELSE id END AS targetId,${timeSql} AS time,${searchText} AS searchText FROM entities WHERE deleted=0 AND type IN (${WORKSPACE_SEARCH_KINDS.map(()=>'?').join(',')}) AND NOT(type='artifacts' AND COALESCE(json_extract(data,'$.archivedAt'),'')<>''))`;
let functionsReady=false;
function ensureFunctions(){
 if(functionsReady)return;
 db.function('native_search_fold',{deterministic:true},value=>String(value??'').toLowerCase());
 db.function('native_search_time',{deterministic:true},(created,updated)=>{
  for(const value of [created,updated]){if(typeof value!=='string'||!value.trim())continue;const date=new Date(value);if(Number.isFinite(date.getTime()))return date.toISOString();}return null;
 });
 functionsReady=true;
}
function integer(raw:string|undefined,fallback:number,name:string,min:number,max=Number.MAX_SAFE_INTEGER){
 if(raw===undefined)return fallback;
 if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw new ApiError(400,'invalid_search_params',`Invalid ${name}`);
 return Number(raw);
}
function plain(raw:string){
 return raw.replace(/<[^>]*>/g,' ').replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
  .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,m=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[m]||m))
  .replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm,'').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
}
const bounded=(value:string,n:number)=>Array.from(value).slice(0,n).join('');
function snippet(raw:string,terms:string[]){
 const text=plain(publicValue({text:raw}).text),fold=text.toLowerCase();
 const indexes=terms.map(term=>fold.indexOf(term.toLowerCase())).filter(i=>i>=0),hit=indexes.length?Math.min(...indexes):0;
 const start=Math.max(0,hit-65),head=start>0?'…':'';
 const body=bounded(text.slice(start),220-head.length);
 return head+body;
}
export function workspaceSearch(params:Record<string,string>){
 const allowed=new Set(['q','kind','offset','limit','revision']);
 if(Object.keys(params).some(key=>!allowed.has(key)))throw new ApiError(400,'invalid_search_params','Unknown search parameter');
 const q=String(params.q??'').trim(),terms=q.split(/\s+/u).filter(Boolean);
 if(!q||Array.from(q).length>500||terms.length>16)throw new ApiError(400,'invalid_search_query','Search needs 1–500 characters and at most 16 terms');
 const kind=params.kind||'all';
 if(kind!=='all'&&!kinds.has(kind))throw new ApiError(400,'invalid_search_kind','Unknown workspace type');
 const offset=integer(params.offset,0,'offset',0),limit=integer(params.limit,50,'limit',1,100),current=revision();
 if(params.revision!==undefined&&integer(params.revision,current,'revision',0)!==current)throw new ApiError(409,'search_changed','Workspace changed; reload search from the first page',{revision:current});
 ensureFunctions();
 const where=[...terms.map(()=>"instr(native_search_fold(searchText),native_search_fold(?))>0"),...(kind==='all'?[]:['kind=?'])].join(' AND ');
 const bound=[...WORKSPACE_SEARCH_KINDS,...terms,...(kind==='all'?[]:[kind])];
 const count=db.prepare(`${cte} SELECT count(*) AS total FROM records WHERE ${where}`).get(...bound) as {total:number};
 const rows=db.prepare(`${cte} SELECT id,kind,targetId,title,time,searchText FROM records WHERE ${where} ORDER BY COALESCE(time,'') DESC,kind ASC,id ASC LIMIT ? OFFSET ?`).all(...bound,limit,offset) as unknown as Array<{id:string;kind:Kind;targetId:string;title:string;time:string|null;searchText:string}>;
 const items=rows.map(row=>publicValue({id:row.id,kind:row.kind,targetId:row.targetId,title:bounded(plain(row.title),180),snippet:snippet(row.searchText,terms),time:row.time}));
 if(revision()!==current)throw new ApiError(409,'search_changed','Workspace changed during search; reload from the first page',{revision:revision()});
 const hasMore=offset+items.length<count.total;
 return {items,total:count.total,offset,limit,hasMore,nextOffset:hasMore?offset+items.length:null,revision:current};
}
export function installWorkspaceSearch(app:Hono){
 app.get('/api/workspace/search',c=>c.json(workspaceSearch(c.req.query())));
}
