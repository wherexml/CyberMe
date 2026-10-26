import {build} from 'esbuild';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)),base=resolve(root,'vendor/task-markdown'),out=resolve(root,'mock/opstwins/vendor');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(resolve(out,'document-manifest.json'),'utf8'));
// DOMPurify is a pinned unmodified ESM distribution and has no external deps.
for(const [file,entry] of Object.entries(manifest.imported.files))if(sha(await readFile(resolve(out,file)))!==entry.sha256)throw Error('Pinned input changed: '+file);
await build({entryPoints:[resolve(base,'browser-entry.js')],outfile:resolve(out,'task-markdown.js'),bundle:true,format:'esm',platform:'browser',target:'es2023',minify:true,legalComments:'inline'});
const lock=JSON.parse(await readFile(resolve(base,'package-lock.json'),'utf8'));let notices='Pinned unified / remark GFM source packages. Install with npm ci --prefix vendor/task-markdown --ignore-scripts.\n';
for(const [path,pkg] of Object.entries(lock.packages)){if(!path)continue;const dir=resolve(base,path);const names=await readdir(dir);const license=names.find(n=>/^licen[cs]e(?:\..*)?$/i.test(n));notices+='\n\n'+path.replace('node_modules/','')+' '+pkg.version+' · '+pkg.license+'\n'+(license?await readFile(resolve(dir,license),'utf8'):'License as declared by pinned package: '+pkg.license)}
await writeFile(resolve(out,'task-markdown-LICENSES.txt'),notices);
manifest.taskMarkdown={packages:lock.packages[''].dependencies,source:'vendor/task-markdown/browser-entry.js',sourceSha256:sha(await readFile(resolve(base,'browser-entry.js'))),lockSha256:sha(await readFile(resolve(base,'package-lock.json'))),bundleSha256:sha(await readFile(resolve(out,'task-markdown.js'))),noticesSha256:sha(Buffer.from(notices))};
await writeFile(resolve(out,'document-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log({bundleBytes:(await readFile(resolve(out,'task-markdown.js'))).length});
