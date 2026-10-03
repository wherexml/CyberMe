/** Narrow, reversible repair. Never classify user uploads by size or name alone. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,db,get,put,activity} from '../server/src/store';
const out=join(ROOT,'output/file-content-repair');mkdirSync(out,{recursive:true});
const targets=[
 {id:'artifact-ac6209c7-3a48-4d3c-b1b0-c376fac42810',sha256:'d9d0c3fb1997dc11499b5776fc25bb458ececc16723764e42fce87bd3aaacc45',reason:'Generated work summary contains only an acknowledgement'},
 {id:'artifact-cf4aeade-78b6-4d5e-b371-b2c60dae9f5f',sha256:'2e2f0a0eaecb5c6c170be31af1bdd61327c6997c933803c9e3241bb0a95c4808',reason:'Known E2E fixture marker, not business material'}
];
const apply=process.argv.includes('--apply'),restore=process.argv.includes('--restore');
if(apply&&restore)throw Error('Choose apply or restore');
const records=targets.map(target=>{const file=get('artifacts',target.id,true);if(!file)throw Error('Missing known artifact '+target.id);const bytes=readFileSync(file.diskPath),sha256=createHash('sha256').update(bytes).digest('hex');if(sha256!==target.sha256||file.sha256!==target.sha256)throw Error('File changed; repair refused '+target.id);return{...target,file,bytes:bytes.length};});
const backup=join(out,'legacy-files-before.json');
if(apply&&!records.every(r=>r.file.archivedAt)){if(existsSync(backup)){const saved=JSON.parse(readFileSync(backup,'utf8'));if(!records.every(record=>saved.some((file:any)=>file.id===record.id&&file.sha256===record.sha256)))throw Error('Existing backup does not match repair targets');}else writeFileSync(backup,JSON.stringify(records.map(r=>r.file),null,2),{flag:'wx',mode:0o600});}
if(apply||restore){db.exec('BEGIN IMMEDIATE');try{for(const record of records){if(apply&&record.file.archivedAt||restore&&!record.file.archivedAt)continue;put('artifacts',{...record.file,archivedAt:restore?undefined:new Date().toISOString(),archiveReason:restore?undefined:record.reason});activity(`${restore?'恢复':'归档'}文件：${record.file.name}`,'file-repair','succeeded',record.reason,record.id);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
const report={action:restore?'restore':apply?'archive':'preview',at:new Date().toISOString(),records:records.map(record=>({id:record.id,name:record.file.name,sha256:record.sha256,bytes:record.bytes,reason:record.reason,archived:!!get('artifacts',record.id,true).archivedAt,downloadPreserved:true}))};
writeFileSync(join(out,`legacy-files-${report.action}.json`),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
