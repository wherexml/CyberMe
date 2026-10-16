#!/usr/bin/env node
// Real installed CLI, self-only read. No source body, ID or credential in artifact.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),id=randomUUID(),work=join(root,'.local/feishu-live-e2e',id),out=join(root,'output/feishu-context/live',id),port=46318,api=`http://127.0.0.1:${port}`,pause=ms=>new Promise(r=>setTimeout(r,ms)),sha=v=>createHash('sha256').update(v).digest('hex');
await mkdir(work,{recursive:true});await mkdir(out,{recursive:true});
await writeFile(join(work,'people.json'),'{"people":[]}');
const start=join(work,'start.ts');await writeFile(start,`import {put} from '${root}/server/src/store.ts';put('connections',{id:'feishu-local',provider:'Feishu',status:'connected',permissions:['read'],config:{scopes:[{id:'all',enabled:true}]}});await import('${root}/server/src/index.ts');`);
const report={scope:'installed CLI self-only read; no send or GUI',checks:[]};let child,log='';
try{
 await new Promise((ok,fail)=>{const s=createServer();s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(ok));});
 child=spawn(process.execPath,['--import','tsx',start],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:'46319',OPSTWIN_DATA_DIR:work,OPSTWIN_PRIVATE_DIR:join(work,'private'),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_FEISHU_CONTEXT_CACHE:join(work,'absent.db'),OPSTWIN_PEOPLE_MAP:join(work,'people.json')},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 for(let i=0;i<100;i++){try{if((await fetch(api+'/api/health')).ok)break;}catch{}await pause(100);}
 const cli=async args=>JSON.parse((await promisify(execFile)(process.env.OPSTWIN_LARK_CLI||'/Users/steve/.local/bin/lark-cli',args,{maxBuffer:2000000,timeout:25000})).stdout);
 const auth=await cli(['auth','status','--json','--verify']);const owner=auth.identities?.user;if(!auth.verified||owner?.userName!=='许茂林')throw Error('self identity unverified');
 const own=await cli(['im','+chat-messages-list','--user-id',owner.openId,'--page-size','1','--no-reactions','--as','user','--format','json']);const ownRows=own.data?.messages||own.data?.items||[];const targetId=ownRows[0]?.chat_id;if(!own.ok||!targetId)throw Error('self chat ID unavailable');
 const r=await fetch(api+'/api/feishu/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'许茂林',targetId,days:3})}),d=await r.json();
 report.httpStatus=r.status;report.resultStatus=d.status;report.errorCode=d.error;report.messageCount=d.messages?.length;report.ownerResponseCount=d.messages?.filter(m=>m.isMine===true).length;report.source=d.coverage?.source;report.gaps=d.coverage?.gaps;report.precision='CLI display time retained; timezone not inferred';report.timeUnknownCount=d.messages?.filter(m=>!m.sentAt&&m.displayTime).length;report.bodyFingerprint=d.messages?sha(JSON.stringify(d.messages.map(m=>({id:m.id,text:m.text})))):undefined;
 report.status=r.ok&&['found','partial'].includes(d.status)&&!(d.coverage?.gaps||[]).length&&d.target?.name==='许茂林'&&d.coverage?.source==='live'?'PASS':'BLOCKED';
}catch(e){report.status='ERROR';report.errorHash=sha(String(e));}finally{if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),pause(4500)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}report.sourceHash=sha(await readFile(join(root,'server/src/feishu-context.ts')));report.logHash=sha(log);await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,report:join(out,'report.json')}));}
