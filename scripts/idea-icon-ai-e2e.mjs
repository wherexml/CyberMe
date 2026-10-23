// Complete production generation/persistence flow with isolated public sources.
// --real uses existing server-side model configuration, without copying credentials.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
const real=process.argv.includes('--real'),scope=resolve('.local/acceptance/idea-icons-'+randomUUID()),out=resolve('output/idea-icon-library-20261023');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const seed=new DatabaseSync(resolve(scope,'opstwin-advance.db'));seed.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT INTO meta VALUES('initialized','true')");seed.close();
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'});
let model,mode='valid',calls=0,promptValid=true;
const scenes=[['release','部署检查','明天下午发布新版本前，需要在虚拟机验证服务部署和回滚。','deploy'],['legal','合同确认','采购合同的付款条款尚未确认，今天需要双方核对并签署。','contract'],['meeting','会议准备','周五产品评审会议需要确认参会人、议程和会议时间。','meeting']];
if(!real){process.env.OPSTWIN_PRIVATE_DIR=scope;await writeFile(resolve(scope,'config.json'),JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46681/v1',apiKey:'public-fixture-key',api:'openai-completions',model:'public-icon-fixture'}}),{mode:0o600});
 model=createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;const input=JSON.parse(body);calls++;const content=input.messages.at(-1).content,text=typeof content==='string'?content:content.map(x=>x.text||'').join('');promptValid&&=['deploy：发布部署','contract：合同','meeting：会议','iconKey'].every(x=>text.includes(x));const ctx=JSON.parse(text.split('资料 JSON：\n').at(-1));
 const ideas=scenes.map(([id,title,,key],i)=>{const source=ctx.sources.find(x=>x.id===id),old=ctx.existingIdeas.find(x=>x.title===title);return {title,description:'核对公开事项。',topicKey:id,category:'insight',...(mode==='missing'?{}:{iconKey:mode==='invalid'?['../../outside','https://invalid.test/icon.svg',{toString:null}][i]:key}),sourceIds:[id],evidence:[{sourceId:id,quote:source.body}],...(old?{existingId:old.id}:{}),mergeIds:[]}});
 res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish_reason] of [[{role:'assistant',content:JSON.stringify({ideas,retire:[]})},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-icon-fixture',choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n');});await new Promise(r=>model.listen(46681,'127.0.0.1',r));}
const S=await import('../server/src/store.ts'),{refreshIdeas}=await import('../server/src/ideas-background.ts'),{validIdeaIcon}=await import('../shared/idea-icons.ts');
S.patchSettings({identity:{name:'公开图标验收',language:'zh-CN'}});for(const [id,title,body] of scenes)S.put('memories',{id,title,body});
const checks=[],check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name)};let selected=[];
try{
 await refreshIdeas('manual','仅分析这三份公开资料，各提出一项有依据的建议并选择匹配图标。');selected=S.list('ideas').map(x=>({id:x.id,title:x.title,iconKey:x.iconKey,sourceIds:x.sourceIds}));
 check('generation persists valid icon choices',selected.length>0&&selected.every(x=>validIdeaIcon(x.iconKey)));
 check('readback preserves chosen key',selected.every(x=>S.get('ideas',x.id).iconKey===x.iconKey));
 if(!real){check('model received semantic catalog',promptValid);check('choices match controlled model response',scenes.every(([id,,,key])=>selected.find(x=>x.sourceIds.includes(id))?.iconKey===key));
 mode='invalid';await refreshIdeas('manual','核对相同事项');check('invalid keys preserve prior valid icons',selected.every(x=>S.get('ideas',x.id).iconKey===x.iconKey));
 mode='missing';await refreshIdeas('manual','核对相同事项');check('omitted keys preserve prior valid icons',selected.every(x=>S.get('ideas',x.id).iconKey===x.iconKey));check('no extra model calls just for icons',calls===3);
 }
 check('no messages tasks or primary mutation',S.list('messages').length===0&&S.list('tasks').length===0&&!S.meta('primaryConversationId',null));
}catch(e){checks.push({name:String(e),pass:false});process.exitCode=1}finally{model?.close();await writeFile(resolve(out,real?'real-model.json':'controlled-model.json'),JSON.stringify({scope:real?'Isolated public data, actual configured model':'Isolated public data, controlled model, production generator',checks,selected,calls:real?undefined:calls},null,2));console.log(JSON.stringify({real,checks,selected}));}
