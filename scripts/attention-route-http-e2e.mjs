// Real Go product proxy -> real Node gateway -> production API/isolated SQLite.
// Run after building .local/attention-route-web: node scripts/attention-route-http-e2e.mjs
// --serve keeps the synthetic stack available for Chrome acceptance. No business data or sends.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const root=process.cwd(),scope=resolve('.local/acceptance/attention-route-'+randomUUID()),out=resolve('output/attention-route-20261106'),children=[],checks=[];
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function start(args,env={}){const child=spawn(args[0],args.slice(1),{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.resume();child.stderr.resume();return child}
async function ready(url){for(let i=0;i<200;i++){try{if((await fetch(url)).status<500)return}catch{}await pause(100)}throw Error('Readiness timeout')}
function check(name,pass){checks.push({name,pass});assert.ok(pass,name)}
const request=async(path,method='GET',body,base='http://127.0.0.1:46854',headers={})=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data}};
try{
 start([process.execPath,'--import','tsx','scripts/attention-browser-fixture.mjs'],{ATTENTION_ASSETS:resolve('.local/attention-route-web')});await ready('http://127.0.0.1:46851/api/health');
 // Relocate only infrastructure addresses/scope. Keep gateway handler/auth/allowlist unchanged.
 const original=await readFile('scripts/mygo-workspace-gateway.mjs','utf8');
 const gateway=original.replace(/const root=.*?,scope=resolve\(root,'\.local\/mygo-desktop'\);/,`const root=${JSON.stringify(scope)},scope=resolve(root,'.local/mygo-desktop');`).replaceAll('46312','46853').replaceAll('46110','46851');
 assert.notEqual(gateway,original);await writeFile(scope+'/gateway.mjs',gateway);
 start([process.execPath,scope+'/gateway.mjs']);await ready('http://127.0.0.1:46853/api/health');
 await copyFile('native/mygo/proxy.go',scope+'/proxy.go');
 await writeFile(scope+'/main.go',`package main
import("net/http";"net/http/httputil";"net/url";"os")
type Link struct {Port int;Token string}
var servicePort="46853"
var serviceScope="fixture"
func expectedPort() int{return 46853}
func ensureDesktopRuntime() error{return nil}
func privateReadScope(scope,name string,limit int)([]byte,error){return os.ReadFile(os.Getenv("ATTENTION_LINK"))}
func main(){u,_:=url.Parse("http://127.0.0.1:46851");http.HandleFunc("/api/",productProxy);http.Handle("/",httputil.NewSingleHostReverseProxy(u));http.ListenAndServe("127.0.0.1:46854",nil)}
`);
 const build=start(['go','build','-o',scope+'/proxy',scope+'/main.go',scope+'/proxy.go']);assert.equal(await new Promise(r=>build.on('exit',r)),0);
 start([scope+'/proxy'],{ATTENTION_LINK:scope+'/.local/mygo-desktop/connection.json'});await ready('http://127.0.0.1:46854/api/health');
 for(const [entityKind,entityId,resource] of [['inbox','urgent','inbox'],['idea','idea-old','ideas']])for(const strategy of ['immediate','digest','quiet','auto']){
  const r=await request('/api/attention/strategy','POST',{entityKind,entityId,strategy});check(`${entityKind} ${strategy} saves through both proxies`,r.status===200&&r.data.deliveryStrategy===strategy);
  const saved=await request('/api/'+resource+'/'+entityId);check(`${entityKind} ${strategy} persists on read`,saved.data.deliveryStrategy===strategy);
 }
 check('invalid strategy reaches API validation',(await request('/api/attention/strategy','POST',{entityKind:'idea',entityId:'idea-old',strategy:'invalid'})).status===400);
 check('action POST reaches API validation',(await request('/api/attention/actions','POST',{})).status===400);
 check('action lookup reaches API',(await request('/api/attention/actions/missing')).status===404);
 const {token}=JSON.parse(await readFile(scope+'/.local/mygo-desktop/connection.json','utf8'));
 for(const [base,headers] of [['http://127.0.0.1:46854',{}],['http://127.0.0.1:46853',{'x-opstwins-pilot':token}]])for(const [path,method] of [['/api/attention/strategy','GET'],['/api/attention/actions','DELETE'],['/api/attention/unknown','POST'],['/api/attention/actions/id/extra','GET']])check(`port ${new URL(base).port} denies ${method} ${path}`,(await request(path,method,undefined,base,headers)).status===403);
 check('gateway still requires credential',(await request('/api/attention/strategy','POST',{},'http://127.0.0.1:46853')).status===403);
 await writeFile(out+'/http.json',JSON.stringify({scope:'synthetic production HTTP through Go proxy and Node gateway; not installed app',checks},null,2));
 console.log(JSON.stringify({passed:checks.length,total:checks.length,artifact:out+'/http.json'}));
 if(process.argv.includes('--serve')){console.log('Browser fixture ready on http://127.0.0.1:46854');await new Promise(r=>{process.once('SIGTERM',r);process.once('SIGINT',r)})}
}finally{for(const c of children.reverse())if(c.exitCode===null)c.kill('SIGTERM');await writeFile(out+'/http.json',JSON.stringify({scope:'synthetic production HTTP through Go proxy and Node gateway; not installed app',checks},null,2))}
