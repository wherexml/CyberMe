import {mkdir, readFile, writeFile, copyFile, readdir, cp, rm} from 'node:fs/promises';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'docs/design'), assets=resolve(root,'native/mygo/assets');
await mkdir(assets,{recursive:true});
for(const name of await readdir(assets))if(name!=='.gitkeep')await rm(resolve(assets,name),{recursive:true,force:true});
let html=await readFile(resolve(source,'macos-ui-study.html'),'utf8');
const manifest=[];
async function copy(relative){
 if(relative.includes('..')||relative.startsWith('/')||!['.js','.css','.svg'].includes(extname(relative)))throw Error('Disallowed design asset');
 const bytes=await readFile(resolve(source,relative));
 await mkdir(dirname(resolve(assets,relative)),{recursive:true});
 await writeFile(resolve(assets,relative),bytes);
 manifest.push({path:relative,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const match of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)){
 if(match[1].startsWith('../../.local/'))continue;
 await copy(match[1]);
}
for(const name of await readdir(resolve(source,'assets')))if(name.endsWith('.svg'))await copy('assets/'+name);
// Never copy snapshots or capability files. This entry is a public, offline visual qualification.
html=html.replace(/<script src="\.\.\/\.\.\/\.local\/design\/macos-study-data.js"><\/script>/,'<script src="public-data.js"></script>')
 .replace(/<script src="\.\.\/\.\.\/\.local\/design\/chat-capability.js"><\/script>/,'')
 .replace('</head>','</head>');
html=html.replace('<title>OpsTwins · macOS UI study</title>','<title>OpsTwins MyGO Preview</title>');
html+='\n<link rel="stylesheet" href="qualification.css"><script src="qualification.js"></script>';
if(html.includes('../../.local/'))throw Error('Private reference remains');
await writeFile(resolve(assets,'index.html'),html);
await writeFile(resolve(assets,'public-data.js'),`window.OPSTWINS_DESIGN_DATA=${JSON.stringify({inbox:[],ideas:[],tasks:[],messages:[],conversations:[],artifacts:[],projects:[],memories:[],automations:[],activities:[],connections:[],settings:{identity:{name:'公开验收',language:'zh-CN'}},models:{providers:[]},histories:{}})};`);
for(const name of ['qualification.js','qualification.css'])await copyFile(resolve(root,'native/mygo',name),resolve(assets,name));
const vite=spawnSync(resolve(root,'node_modules/.bin/vite'),['build','--config','web/mygo.vite.config.ts'],{cwd:root,stdio:'inherit'});if(vite.status!==0)process.exit(vite.status||1);
await cp(resolve(root,'.local/mygo-web'),assets,{recursive:true});
await cp(resolve(root,'native/mygo/licenses'),resolve(assets,'licenses'),{recursive:true});
const app=resolve(root,'.local/apps/OpsTwins MyGO Preview.app');
await mkdir(resolve(app,'Contents/MacOS'),{recursive:true});
const result=spawnSync('go',['build','-trimpath',`-ldflags=-X github.com/egoist/mygo.production=1 -X main.workspaceRoot=${root}`,'-o',resolve(app,'Contents/MacOS/opstwins-mygo'),'.'],{cwd:resolve(root,'native/mygo'),env:{...process.env,GOTOOLCHAIN:'go1.27.1'},stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
await writeFile(resolve(app,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.opstwins.mygo.preview</string><key>CFBundleName</key><string>OpsTwins MyGO Preview</string><key>CFBundleExecutable</key><string>opstwins-mygo</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>NSHighResolutionCapable</key><true/><key>NSMicrophoneUsageDescription</key><string>验证 OpsTwins 听写的麦克风权限；录音只在内存。</string></dict></plist>`);
const sign=spawnSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});if(sign.status!==0)process.exit(sign.status||1);
const bytes=await readFile(resolve(app,'Contents/MacOS/opstwins-mygo'));
await mkdir(resolve(root,'output/mygo-1007'),{recursive:true});
const builtAt=new Date().toISOString();
const files=[];async function scan(dir,prefix=''){for(const name of (await readdir(dir)).sort()){const path=resolve(dir,name),rel=prefix+name;const stat=await (await import('node:fs/promises')).lstat(path);if(stat.isDirectory())await scan(path,rel+'/');else if(stat.isFile()){const raw=await readFile(path);files.push({path:rel,sha256:createHash('sha256').update(raw).digest('hex')})}else throw Error('Unexpected asset type')}}
await scan(assets);
const record=JSON.stringify({at:builtAt,mygo:'v0.2.15',go:'1.27.1',app,bundleExecutableSHA256:createHash('sha256').update(bytes).digest('hex'),sourceDesignAssets:manifest,embeddedAssets:files},null,2);
await mkdir(resolve(root,'output/mygo-1007/builds'),{recursive:true});
await writeFile(resolve(root,'output/mygo-1007/builds',builtAt.replaceAll(':','-')+'.json'),record);
await writeFile(resolve(root,'output/mygo-1007/build.json'),record);

console.log(app);
