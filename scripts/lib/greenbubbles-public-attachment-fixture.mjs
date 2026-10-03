// Public fixture for complete GreenBubbles CLI + isolated production HTTP E2E.
// Derived from tracked MIT GreenBubbles live_attachment::message_attachment_fixture.
// No production databases, credentials, profiles or user media are read.
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readdirSync,realpathSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const fixtureCode="import sqlite3,hashlib,json,os,sys\nfrom pathlib import Path\nbase=Path(sys.argv[1]);os.umask(0o077)\naccount=base/'account';db=account/'db_storage';out=base/'materialized'\nfor s in ['contact','session','message','media','hardlink']:(db/s).mkdir(parents=True,exist_ok=True)\nout.mkdir(exist_ok=True)\nconv='wxid_OPSADV_QA_attachment';table='Msg_'+hashlib.md5(conv.encode()).hexdigest()\ndef conn(s):return sqlite3.connect(db/s)\nc=conn('contact/contact.db');c.executescript(\"CREATE TABLE contact(username TEXT PRIMARY KEY, remark TEXT, nick_name TEXT, alias TEXT);INSERT INTO contact VALUES ('wxid_OPSADV_QA_sender','OPSADV-QA Sender','','');\");c.close()\nc=conn('session/session.db');c.execute('CREATE TABLE SessionTable(username TEXT, sort_timestamp INTEGER, summary BLOB)');c.execute('INSERT INTO SessionTable VALUES (?,300,?)',(conv,b'OPSADV-QA attachment'));c.commit();c.close()\nvoice=b'\\x02#!SILK_V3synthetic-lossless-voice';video=b'\\x00\\x00\\x00\\x18ftypmp42synthetic-video';docs=[b'%PDF-1.7 OPSADV-QA document A',b'%PDF-1.7 OPSADV-QA document B']\nvm=hashlib.md5(video).hexdigest();dm=[hashlib.md5(x).hexdigest() for x in docs]\n# Official PackedInfo schema: type=106/version=14/video(tag4).md5(tag8).\nvpack=b'\\x08j\\x10\\x0e'+bytes([34,34,66,32])+vm.encode()\nc=conn('message/message_0.db');c.executescript(\"CREATE TABLE Name2Id(user_name TEXT); INSERT INTO Name2Id(rowid,user_name) VALUES (1,'wxid_OPSADV_QA_sender');\"+f'CREATE TABLE [{table}](server_id INTEGER,sort_seq INTEGER,local_type INTEGER,real_sender_id INTEGER,create_time INTEGER,status INTEGER,message_content BLOB,packed_info_data BLOB,WCDB_CT_message_content INTEGER,compress_content BLOB);')\nrows=[(3002,400,34,voice[:0],b''),(3003,300,43,b'',vpack)]\nfor i in range(2):rows.append((3004+i,200-i,(6<<32)|49,f'<msg><appmsg><title>report-{i}.pdf</title><fileext>pdf</fileext><totallen>{len(docs[i])}</totallen><md5>{dm[i]}</md5></appmsg></msg>'.encode(),b''))\nfor svr,seq,kind,content,packed in rows:c.execute(f'INSERT INTO [{table}](server_id,sort_seq,local_type,real_sender_id,create_time,status,message_content,packed_info_data,WCDB_CT_message_content) VALUES (?,?,?,1,200,0,?,?,0)',(svr,seq,kind,content,packed))\nc.commit();c.close()\nc=conn('media/media_0.db');c.execute('CREATE TABLE VoiceInfo(svr_id INTEGER,voice_data BLOB)');c.execute('INSERT INTO VoiceInfo VALUES (3002,?)',(voice,));c.commit();c.close()\nc=conn('hardlink/hardlink.db');c.executescript(\"CREATE TABLE dir2id(rowid INTEGER PRIMARY KEY,username TEXT);CREATE TABLE video_hardlink_info_v3(md5 TEXT,file_name TEXT,file_size INTEGER,modify_time INTEGER,dir1 INTEGER,dir2 INTEGER);CREATE TABLE file_hardlink_info_v3(md5 TEXT,file_name TEXT,file_size INTEGER,modify_time INTEGER,dir1 INTEGER,dir2 INTEGER);\")\nc.executemany('INSERT INTO dir2id VALUES (?,?)',[(1,conv),(2,'2026-08')]);c.execute('INSERT INTO video_hardlink_info_v3 VALUES (?,?,?,?,1,2)',(vm,'video.mp4',len(video),1))\nvd=account/'msg/attach'/conv/'2026-08/Video';fd=account/'msg/file'/conv/'2026-08';vd.mkdir(parents=True);fd.mkdir(parents=True);(vd/'video.mp4').write_bytes(video)\nfor i,data in enumerate(docs):c.execute('INSERT INTO file_hardlink_info_v3 VALUES (?,?,?,?,1,2)',(dm[i],f'report-{i}.pdf',len(data),1));(fd/f'report-{i}.pdf').write_bytes(data)\nc.commit();c.close()\nprint(json.dumps({'conversation':conv,'databaseRoot':str(db),'accountRoot':str(account),'outputRoot':str(out),'expected':{'voice':hashlib.sha256(voice).hexdigest(),'video':hashlib.sha256(video).hexdigest(),'documents':[hashlib.sha256(x).hexdigest() for x in docs]}}))\n";
const digest=x=>createHash('sha256').update(x).digest('hex');
/** Create a fresh public source in an empty contained .local directory.
 * Returned paths/bytes belong only to synthetic OPSADV-QA fixture; do not use live source.
 */
export function createPublicAttachmentFixture(root){
 const path=resolve(root),rel=relative(project+'/.local',path);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Fixture root must be a dedicated project .local child');
 // Reject every existing descendant symlink before any mkdir/write. No private file contents read.
 let ancestor=project;
 for(const part of relative(project,path).split('/')){
  ancestor=resolve(ancestor,part);
  if(existsSync(ancestor)||(()=>{try{lstatSync(ancestor);return true}catch{return false}})()){
   const m=lstatSync(ancestor);
   if(m.isSymbolicLink()||!m.isDirectory()||m.uid!==process.getuid()||(m.mode&0o022)!==0)throw Error('Unsafe fixture directory boundary');
  }
 }
 mkdirSync(path,{recursive:true,mode:0o700});chmodSync(path,0o700);
 if(!realpathSync(path).startsWith(realpathSync(project)+'/.local/')||readdirSync(path).length)throw Error('Fixture root must be empty and contained');
 const result=spawnSync('python3',['-c',fixtureCode,path],{encoding:'utf8',timeout:5000,maxBuffer:1000000});
 if(result.status!==0)throw Error('Public attachment fixture creation failed');
 let value;try{value=JSON.parse(result.stdout)}catch{throw Error('Public fixture metadata unavailable')}
 const expectedBytes={voice:Buffer.from('\x02#!SILK_V3synthetic-lossless-voice','binary'),video:Buffer.from('\x00\x00\x00\x18ftypmp42synthetic-video','binary'),documents:[Buffer.from('%PDF-1.7 OPSADV-QA document A'),Buffer.from('%PDF-1.7 OPSADV-QA document B')]};
 if(value.expected.voice!==digest(expectedBytes.voice)||value.expected.video!==digest(expectedBytes.video)||value.expected.documents.some((h,i)=>h!==digest(expectedBytes.documents[i])))throw Error('Public fixture expected bytes mismatch');
 return {...value,expectedBytes,scope:'publicSynthetic',messageCount:4,sameSecondUnix:200,sourceSchema:'upstream public message_attachment_fixture-derived SQLite/hardlink',fixtureSchemaHash:digest(fixtureCode)};
}
