// Run: node --import tsx scripts/github-issue-chat-e2e.mjs [--live]
// Failure cases: docs/sprints-1109/APPLE-GITHUB-FAILURES.md.
// Production Chat HTTP -> controlled model -> fixed git CLI. --live uses the existing gh login for one public issue.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {serve} from '@hono/node-server';

const dir=resolve('.local/acceptance/github-issue-'+randomUUID()),out=resolve('output/apple-github-connections-20261109');
const port=46864,modelPort=46865,live=process.argv.includes('--live'),checks=[];
const issueTool='read_github_issue';
await mkdir(dir,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:dir,OPSTWIN_PRIVATE_DIR:dir,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_WEB_PORT:String(port),OPSTWIN_API_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
await writeFile(dir+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:'+modelPort+'/v1',apiKey:'public-fixture',api:'openai-completions',model:'public-issue-model'}}),{mode:0o600});
const db=new DatabaseSync(resolve(dir,'opstwin-advance.db'));
db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.close();
const repo=live?'cli/cli':'public/fixture';
const known=live?JSON.parse(execFileSync('gh',['api','--hostname','github.com','--method','GET','repos/cli/cli/issues?per_page=15','--jq','map(select(.pull_request | not))[0] | {number,title,html_url}'],{timeout:12000,encoding:'utf8',stdio:['ignore','pipe','pipe']})):{number:31,title:'Public Issue Fixture',html_url:'https://github.com/public/fixture/issues/31'};
assert.ok(known?.number&&known?.title&&known?.html_url);
if(!live){
 await writeFile(dir+'/gh',`#!${process.execPath}
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(dir+'/calls.jsonl')},JSON.stringify(args.slice(0,6))+'\\n');
if(args.slice(0,5).join(' ')!=='api --hostname github.com --method GET'||!/^repos\\/public\\/fixture\\/(issues\\/(31|32|33)|pulls\\/31(?:\\/files.*)?)$/.test(args[5]))process.exit(9);
if(args[5].endsWith('/33')){console.error('gh: HTTP 404');process.exit(1)}
const issue={id:123,number:31,title:'Public Issue Fixture',state:'open',html_url:'https://github.com/public/fixture/issues/31',body:'fixture only',labels:[{name:'public'}],assignees:[],updated_at:'2026-11-08T10:00:00Z'};
const payload=args[5].endsWith('/32')?{...issue,number:32,pull_request:{url:'https://api.github.com/repos/public/fixture/pulls/32'}}:args[5].includes('/files')?[]:args[5].includes('/pulls')?{...issue,head:{sha:'public-sha'},changed_files:0,additions:0,deletions:0}:issue;
if(args[6]==='--jq'){
 const r=spawnSync('/usr/bin/jq',['-c',args[7]],{input:JSON.stringify(payload),encoding:'utf8'});process.stdout.write(r.stdout);process.exit(r.status);
}
process.stdout.write(JSON.stringify(payload));
`,{mode:0o700});
 process.env.PATH=dir+':'+process.env.PATH;
}
const S=await import('../server/src/store.ts');
S.put('conversations',{id:'main',title:'GitHub Issue 公共验收'});S.setMeta('primaryConversationId','main');
const chunk=(res,delta,reason)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:reason}]})+'\n\n');
let responseTool;
const model=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;
 const {messages,tools}=JSON.parse(raw),i=messages.findLastIndex(m=>m.role==='user');
 const prompt=typeof messages[i]?.content==='string'?messages[i].content:messages[i]?.content?.[0]?.text;
 const direct=prompt?.split('当前用户请求：\n').at(-1)||'';
 const existing=messages.slice(i+1).findLast(m=>m.role==='tool');
 const name=direct.includes('PR31')?'read_github_pull_request':issueTool;
 const n=direct.includes('#32')?32:direct.includes('#33')?33:known.number;
 res.writeHead(200,{'content-type':'text/event-stream'});
 if(!existing&&tools?.some(t=>t.function?.name===name)){
  const input={repository:direct.includes('错误仓库')?'../wrong':repo,number:n,evidence:direct};
  chunk(res,{role:'assistant',tool_calls:[{index:0,id:'public-issue-call',type:'function',function:{name,arguments:JSON.stringify(input)}}]},null);chunk(res,{},'tool_calls');
 }else{
  responseTool=existing?.content;
  chunk(res,{role:'assistant',content:responseTool?.includes(known.title)?'ISSUE_FIXTURE_CONFIRMED':'NO_ISSUE_RESULT'},null);chunk(res,{},'stop');
 }
 res.end('data: [DONE]\n\n');
});
await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts');
const server=serve({fetch:app.fetch,port,hostname:'127.0.0.1'});
const url='http://127.0.0.1:'+port+'/api/chat';
const send=(message,extra={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),conversationId:'main',message,...extra})}).then(async r=>({status:r.status,data:await r.json()}));
const expect=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name)};
const calls=async()=>JSON.parse('['+(await readFile(dir+'/calls.jsonl','utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).join(',')+']');
try{
 const exact=await send('请查看 GitHub Issue '+repo+' #'+known.number);
 expect('Chat reads exact Issue via registered read tool',exact.status===200&&exact.data.assistantMessage?.content==='ISSUE_FIXTURE_CONFIRMED'&&responseTool?.includes(known.html_url));
 expect('recorded tool is read-only and commits no writes',exact.data.run?.tools?.some(x=>x.name===issueTool&&x.effect==='read'&&x.status==='succeeded')&&exact.data.run?.taskOutcome?.committedWrites===0);
 if(!live){
  expect('one fixed GitHub GET targets exactly the Issue',JSON.stringify(await calls())===JSON.stringify([['api','--hostname','github.com','--method','GET','repos/public/fixture/issues/31']]));
  await send('请查看 GitHub Issue '+repo+' #32');
  expect('PR-shaped payload never presented as Issue',!responseTool?.includes('Public Issue Fixture')&&!!responseTool);
  await send('请查看 GitHub Issue '+repo+' #33');
  expect('upstream not found never reports a successful Issue read',!responseTool?.includes('Public Issue Fixture')&&!!responseTool);
  const before=(await calls()).length;
  await send('请查看 GitHub Issue #31');
  await send('请查看 GitHub Issue '+repo+' #31 错误仓库');
  await send('只解释这句引用：“请查看 GitHub Issue '+repo+' #31”。');
  expect('missing repository, invalid repository and quote make no CLI requests',(await calls()).length===before);
  await send('请查看 GitHub Issue public/fixture-other #31');
  expect('a longer repository name never authorizes its prefix',(await calls()).length===before);
  const pr=await send('请查看 '+repo+' PR31');
  expect('existing PR tool remains in use',pr.data.run?.tools?.some(x=>x.name==='read_github_pull_request'&&x.status==='succeeded'));
 }
}finally{
 await writeFile(resolve(out,live?'github-issue-live.json':'github-issue-http.json'),JSON.stringify({url,checks,scope:live?'real public GitHub API; controlled Chat model':'production Chat SDK with controlled GitHub CLI and model',...(live?{publicIssue:known.html_url}:{})},null,2));
 await Promise.all([server,model].map(x=>new Promise(r=>x.close(r))));
}
console.log(JSON.stringify({checks:checks.length,live}));
