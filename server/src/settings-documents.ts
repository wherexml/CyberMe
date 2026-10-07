import {db,list,put,remove,hash,settings,patchSettings,snapshotMemories} from './store';
import {ApiError} from './integrations';
const personal=()=>list('memories').filter(m=>!m.sourceSystem&&['personal','preference'].includes(m.kind));
export function settingsDocument(kind:string){
 if(kind==='soul'){const identity=settings().identity as any;return {kind,content:typeof identity.markdown==='string'?identity.markdown:[identity.name?'# '+identity.name:'',identity.role,identity.about,identity.instructions].filter(Boolean).join('\n\n'),version:hash(identity)};}
 if(kind!=='memory')throw new ApiError(404,'document_not_found','文档不存在');
 const rows=personal();return {kind,content:rows.map(m=>String(m.content??m.body??'')).filter(Boolean).join('\n\n'),version:hash(rows.map(m=>[m.id,m.updatedAt,m.content,m.body])),legacyCount:rows.length};
}
export function saveSettingsDocument(kind:string,input:any){
 if(typeof input.content!=='string'||input.content.length>200000)throw new ApiError(400,'invalid_document','Markdown 文档最多 200000 字符');
 db.exec('BEGIN IMMEDIATE');try{
 const current=settingsDocument(kind);if(input.version!==current.version)throw new ApiError(409,'edit_conflict','文档已更新，输入已保留，请读取最新版本后核对');
 if(current.content!==input.content){if(kind==='soul'){patchSettings({identity:{markdown:input.content,instructions:input.content}},'edit_soul_document');}else{
 snapshotMemories('edit_memory_document');for(const row of personal())remove('memories',row.id);
 // A single current document; old personal records remain recoverable in snapshots.
 const saved=put('memories',{id:'opstwins-memory-document',title:'MEMORY.md',kind:'personal',body:input.content,content:input.content});
 db.prepare("UPDATE entities SET deleted=0 WHERE type='memories' AND id=?").run(saved.id);
 }}
 const saved=settingsDocument(kind);db.exec('COMMIT');return saved;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function settingsDocumentHistory(kind:string){
 settingsDocument(kind);
 const rows=db.prepare(kind==='soul'?'SELECT id,data,created_at FROM settings_history ORDER BY created_at DESC LIMIT 30':'SELECT id,data,created_at FROM memory_history ORDER BY created_at DESC LIMIT 30').all() as any[];
 return rows.map(row=>{const value=JSON.parse(row.data);const identity=value.identity;return {id:row.id,createdAt:row.created_at,content:kind==='soul'?(typeof identity?.markdown==='string'?identity.markdown:[identity?.name?'# '+identity.name:'',identity?.role,identity?.about,identity?.instructions].filter(Boolean).join('\n\n')):value.filter((m:any)=>!m.sourceSystem&&['personal','preference'].includes(m.kind)).map((m:any)=>String(m.content??m.body??'')).filter(Boolean).join('\n\n')};});
}
