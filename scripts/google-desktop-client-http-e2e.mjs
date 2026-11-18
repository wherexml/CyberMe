// Run: node --import tsx scripts/google-desktop-client-http-e2e.mjs
// Failure cases: docs/sprints-1109/APPLE-GITHUB-FAILURES.md.
import {strict as assert} from 'node:assert';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile,stat,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {serve} from '@hono/node-server';
const dir=resolve('.local/acceptance/google-desktop-'+randomUUID()),out=resolve('output/apple-github-connections-20261109');
const port=46862,client='public-desktop-test.apps.googleusercontent.com',secret='public-fixture-client-secret';
await mkdir(dir,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:dir,OPSTWIN_PRIVATE_DIR:dir,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port)});
delete process.env.OPSTWIN_GOOGLE_CLIENT_ID;delete process.env.OPSTWIN_GOOGLE_CLIENT_SECRET;
const db=new DatabaseSync(resolve(dir,'opstwin-advance.db'));
db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.close();
const doc=resolve(dir,'synthetic-client.json');await writeFile(doc,JSON.stringify({installed:{client_id:client,client_secret:secret}}),{mode:0o600});
const {app}=await import('../server/src/index.ts');
const server=serve({fetch:app.fetch,port,hostname:'127.0.0.1'});
const checks=[],expect=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name)};
const get=async()=>fetch('http://127.0.0.1:'+port+'/api/connections/google/status').then(r=>r.json());
try{
 expect('without private config or environment client is unconfigured',(await get()).configured===false);
 const command=['--import','tsx','scripts/configure-google-desktop-oauth.mjs','--client-json',doc,'--private-dir',dir];
 const saved=spawnSync(process.execPath,command,{encoding:'utf8'});
 expect('local CLI imports official Desktop JSON with no credential output',saved.status===0&&![client,secret].some(v=>(saved.stdout+saved.stderr).includes(v)));
 const ciphertext=resolve(dir,'google-oauth','desktop-client.enc');
 const bytes=await readFile(ciphertext);
 expect('private client is encrypted with owner-only mode',!bytes.includes(Buffer.from(secret))&&(await stat(ciphertext)).mode%512===0o600);
 expect('existing configuration cannot be overwritten by accident',spawnSync(process.execPath,command,{encoding:'utf8'}).status!==0);
 const status=await get();
 expect('API recognizes private client without process environment',status.configured&&!JSON.stringify(status).includes(secret)&&!JSON.stringify(status).includes(client));
 const auth=await fetch('http://127.0.0.1:'+port+'/api/connections/google/authorize',{method:'POST'}).then(r=>r.json());
 const url=new URL(auth.url);
 expect('official Google authorization begins with Desktop client and PKCE',url.origin==='https://accounts.google.com'&&url.searchParams.get('client_id')===client&&url.searchParams.get('code_challenge_method')==='S256'&&!JSON.stringify(auth).includes(secret));
 await chmod(ciphertext,0o644);
 expect('unsafe file permissions fail closed',(await get()).configured===false);
 await chmod(ciphertext,0o600);await writeFile(ciphertext,Buffer.alloc(32));
 expect('tampered encrypted client fails closed',(await get()).configured===false);
}finally{
 await writeFile(resolve(out,'gmail-private-client-http.json'),JSON.stringify({checks,scope:'isolated production HTTP and configuration command; no real Google login'},null,2));
 await new Promise(r=>server.close(r));
}
console.log(JSON.stringify({checks:checks.length}));
