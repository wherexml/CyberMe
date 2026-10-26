// Build the real OpsTwins web surface into an isolated directory; no App bundle touched.
import {mkdir,readdir,copyFile,readFile,writeFile,cp} from 'node:fs/promises';import {resolve,join,extname} from 'node:path';import {build} from 'vite';import {fullAssets} from './mygo-full-assets.mjs';
const root=resolve(import.meta.dirname,'..'),assets=resolve(root,'.local/virtual-im-workspace/assets'),source=resolve(root,'docs/design');await mkdir(assets,{recursive:true});
await build({configFile:resolve(root,'web/mygo.vite.config.ts'),build:{outDir:assets,emptyOutDir:true}});
for(const entry of await readdir(source,{withFileTypes:true})){if(entry.isFile()&&['.js','.css'].includes(extname(entry.name)))await copyFile(join(source,entry.name),join(assets,entry.name));}
await mkdir(join(assets,'assets'),{recursive:true});for(const name of await readdir(join(source,'assets')))if(name.endsWith('.svg'))await copyFile(join(source,'assets',name),join(assets,'assets',name));
await cp(join(source,'vendor'),join(assets,'vendor'),{recursive:true});await fullAssets(root,assets);const index=join(assets,'desktop.html');let html=await readFile(index,'utf8');html=html.replace('<title>OpsTwins</title>','<title>OpsTwins · 虚拟 IM 测试</title>');await writeFile(index,html);console.log('Virtual IM isolated OpsTwins assets built');
