// Complete-process public attachment regressions only; never live/private/profile reads.
import {createPublicAttachmentFixture} from './lib/greenbubbles-public-attachment-fixture.mjs';
import {spawnSync} from 'node:child_process';import{readFileSync,writeFileSync,mkdtempSync,mkdirSync,unlinkSync,renameSync,symlinkSync,existsSync,lstatSync}from'node:fs';import{createHash}from'node:crypto';import{dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=project+'/output/native-parity-20261003/wechat-attachment-cli',sha=x=>createHash('sha256').update(x).digest('hex');
const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--candidate'))throw Error('Usage: --candidate <immutable CLI>');const ready=JSON.parse(readFileSync(out+'/candidate-ready.json')),cli=args[1]||ready.candidateCli;
if(lstatSync(cli).isSymbolicLink()||!resolve(cli).startsWith(project+'/.local/greenbubbles-attachment-candidate/bin/')||(lstatSync(cli).mode&0o222)!==0)throw Error('Archived contained CLI required');
const report={schema:1,at:new Date().toISOString(),scope:'fresh public SQLite + complete CLI process; no live data/profile/credentials',compiledHash:sha(readFileSync(cli)),checks:[],scriptHash:sha(readFileSync(fileURLToPath(import.meta.url)))};
const run=args=>{const p=spawnSync(cli,args,{encoding:'utf8',timeout:30000,maxBuffer:4000000});let v;try{v=JSON.parse(p.stdout)}catch{}return{exit:p.status,v,stdoutHash:sha(p.stdout||''),stderrHash:sha(p.stderr||'')}};
const fixture=()=>{const f=createPublicAttachmentFixture(mkdtempSync(project+'/.local/attachment-integrity.'));const p=run(['messages','list',f.databaseRoot,'--decrypted','--conversation',f.conversation,'--limit','16','--json']);if(p.exit!==0||p.v?.items?.length!==4)throw Error('public typed source unavailable');return {...f,items:p.v.items}};
const inspect=(f,m,kind)=>run(['attachment','inspect',f.accountRoot,'--decrypted','--conversation',f.conversation,'--message',m.id,'--kind',kind]);
const materialize=(f,m,kind,id,path)=>run(['attachment','materialize',f.accountRoot,'--decrypted','--conversation',f.conversation,'--message',m.id,'--kind',kind,'--attachment',id,'--output',path]);
const readCase=(id,f,m,kind,expected,shouldReject=false)=>{const i=inspect(f,m,kind),dest=f.outputRoot+'/'+id;const p=i.v?.preferredAttachmentId?materialize(f,m,kind,i.v.preferredAttachmentId,dest):null;const published=existsSync(dest),actual=published?sha(readFileSync(dest)):null;const pass=shouldReject?(i.exit!==0||!i.v?.preferredAttachmentId)&&!published:i.exit===0&&i.v?.candidateCount===1&&p?.exit===0&&actual===sha(expected);report.checks.push({id,status:pass?'PASS':'FAIL',inspectExit:i.exit,materializeExit:p?.exit,candidateCount:i.v?.candidateCount,published,expectedHash:expected?sha(expected):null,actualHash:actual,stdoutHash:i.stdoutHash,stderrHash:i.stderrHash});};
{
const f=fixture(),dir=f.accountRoot+'/msg/file/'+f.conversation+'/2026-07';mkdirSync(dir,{recursive:true,mode:0o700});writeFileSync(dir+'/report-0.pdf','%PDF-1.7 OPSADV-QA previous different content');readCase('F20-CORRECT-DOC-WRONG-SAME-TITLE',f,f.items.find(m=>m.serverId===3004),'document',f.expectedBytes.documents[0]);
}
{
const f=fixture(),m=f.items.find(m=>m.messageType===43);writeFileSync(f.accountRoot+'/msg/attach/'+f.conversation+'/2026-08/Video/video.mp4',Buffer.from('OPSADV-QA wrong video content'));readCase('F21-VIDEO-WRONG-HARDLINK-BYTES',f,m,'video',null,true);
}
{
const f=fixture(),m=f.items.find(m=>m.messageType===43),md5=createHash('md5').update(f.expectedBytes.video).digest('hex'),path=f.accountRoot+'/msg/attach/'+f.conversation+'/2026-08/Video';unlinkSync(path+'/video.mp4');writeFileSync(path+'/'+md5+'-cached.mp4','OPSADV-QA filename does not identify video bytes');readCase('F21-VIDEO-WRONG-MD5-FILENAME',f,m,'video',null,true);
}
{
const f=fixture(),m=f.items.find(m=>m.messageType===43),md5=createHash('md5').update(f.expectedBytes.video).digest('hex'),path=f.accountRoot+'/msg/attach/'+f.conversation+'/2026-08/Video';writeFileSync(path+'/'+md5+'-wrong.mp4','OPSADV-QA incorrect competing video');readCase('F21-VIDEO-VALID-AND-WRONG-CONTENT',f,m,'video',f.expectedBytes.video);
}
for(const same of [false,true]){
const f=fixture(),db=f.databaseRoot+'/media/media_1.db',data=same?f.expectedBytes.voice:Buffer.from('\x02#!SILK_V3OPSADV-QA distinct voice','binary');const x=spawnSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);c.execute("CREATE TABLE VoiceInfo(svr_id INTEGER,voice_data BLOB)");c.execute("INSERT INTO VoiceInfo VALUES(3002,?)",(bytes.fromhex(sys.argv[2]),));c.commit();c.close()',db,data.toString('hex')],{encoding:'utf8'});if(x.status!==0)throw Error('public voice fixture failed');readCase(same?'F22-VOICE-DUPLICATE-BYTES-DEDUP':'F22-VOICE-DIFFERENT-BYTES-AMBIGUOUS',f,f.items.find(m=>m.messageType===34),'voice',same?f.expectedBytes.voice:null,!same);
}
for(const kind of ['video','document']){
const f=fixture(),m=f.items.find(m=>kind==='video'?m.messageType===43:m.serverId===3004),family=kind==='video'?'attach':'file';const source=f.accountRoot+'/msg/'+family+'/'+f.conversation+'/2026-08',other=f.accountRoot+'/msg/'+family+'/wxid_OPSADV_QA_other';mkdirSync(other,{recursive:true,mode:0o700});renameSync(source,other+'/2026-08');symlinkSync(other+'/2026-08',source);readCase('F23-'+kind.toUpperCase()+'-CROSS-CONVERSATION-SYMLINK',f,m,kind,null,true);
}
report.status=report.checks.some(x=>x.status==='FAIL')?'FAIL':'PASS_SCOPE';report.counts=Object.fromEntries(['PASS','FAIL'].map(x=>[x,report.checks.filter(c=>c.status===x).length]));const name='integrity-e2e-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';writeFileSync(out+'/'+name,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,counts:report.counts,compiledHash:report.compiledHash,artifact:name}));if(report.status==='FAIL')process.exitCode=1;
