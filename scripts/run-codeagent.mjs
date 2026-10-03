import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../.local/config.json',import.meta.url),'utf8'));
const model=process.argv[2]||'haiku';const external=model!=='haiku';
const resume=process.argv[3];
let prompt='';if(resume)for await(const chunk of process.stdin)prompt+=chunk;
const args=['--backend','claude','--model',model,'--backend-output',...(resume?['resume',resume,prompt,root]:['-',root])];
if(process.env.OPSTWIN_AGENT_AUTO==='1')args.unshift('--skip-permissions');
const env={...process.env};if(external){const baseUrl=config.llm.deepBaseUrl||config.llm.baseUrl;const apiKey=config.llm.deepApiKey||config.llm.apiKey;env.ANTHROPIC_BASE_URL=baseUrl;env.ANTHROPIC_AUTH_TOKEN=apiKey;env.ANTHROPIC_API_KEY=apiKey;}
const child=spawn('codeagent-wrapper',args,{cwd:root,env,stdio:['pipe','inherit','inherit']});
if(!resume)process.stdin.pipe(child.stdin);else child.stdin.end();child.on('exit',code=>process.exit(code??1));
