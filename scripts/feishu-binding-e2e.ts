import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:46110/api/feishu/binding';
const checks:string[]=[];
async function request(path='',method='GET'){const r=await fetch(base+path,{method,headers:method==='POST'?{'Content-Type':'application/json'}:{},...(method==='POST'?{body:'{}'}:{})});const b=await r.json();assert.equal(r.status,200,`HTTP ${r.status}: ${b.message||b.error||''}`);for(const key of ['device_code','deviceCode','clientSecret','client_secret','openId'])assert.equal(b[key],undefined);return b;}
const before=await request();checks.push('GET status contains no private credentials');
const begin=await request('','POST');assert.ok(['pending','bound'].includes(begin.status));checks.push('Real Feishu begin or existing binding');
if(begin.status==='pending'){assert.ok(begin.qr.startsWith('data:image/png;base64,'));assert.ok(new URL(begin.url).hostname.endsWith('.feishu.cn'));const again=await request('','POST');assert.equal(again.url,begin.url);assert.equal(again.expiresAt,begin.expiresAt);checks.push('Repeated begin reuses existing authorization');const restored=await request();assert.equal(restored.url,begin.url);checks.push('Status reload restores same QR session');}
const poll=await request('/poll','POST');assert.ok(['pending','bound','expired','denied'].includes(poll.status));checks.push('Poll returns safe authorization state');
const blocked=await fetch(base,{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);checks.push('Cross-origin begin is rejected');
mkdirSync('output/feishu-binding',{recursive:true});writeFileSync('output/feishu-binding/http-e2e.json',JSON.stringify({at:new Date().toISOString(),checks,initial:before.status,final:poll.status,authorizationComplete:poll.status==='bound'},null,2));console.log({checks:checks.length,status:poll.status});
