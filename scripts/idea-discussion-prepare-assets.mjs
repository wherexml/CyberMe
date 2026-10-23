import {mkdir,readFile,cp,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fullAssets} from './mygo-full-assets.mjs';
const source=resolve('docs/design'),assets=resolve('.local/idea-discussion-assets');
const html=await readFile(resolve(source,'macos-ui-study.html'),'utf8');
for(const m of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)){
 const name=m[1];if(name.startsWith('../../.local/'))continue;
 if(name.includes('..')||name.startsWith('/'))throw Error('Invalid reference');
 await mkdir(dirname(resolve(assets,name)),{recursive:true});await cp(resolve(source,name),resolve(assets,name));
}
await mkdir(resolve(assets,'assets'),{recursive:true});
for(const name of await readdir(resolve(source,'assets')))if(name.endsWith('.svg'))await cp(resolve(source,'assets',name),resolve(assets,'assets',name));
await fullAssets(process.cwd(),assets);
