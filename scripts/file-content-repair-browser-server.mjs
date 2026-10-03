/** Serve the latest isolated E2E data for repeatable browser verification. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const latest=JSON.parse(readFileSync(join(root,'output/file-content-repair/http-latest.json'),'utf8'));
const manifest=JSON.parse(readFileSync(join(latest.out,'manifest.json'),'utf8'));
process.env.OPSTWIN_DATA_DIR=join(root,'data',manifest.tag);
process.env.OPSTWIN_NO_BACKGROUND='1';process.env.OPSTWIN_API_PORT='46116';process.env.OPSTWIN_WEB_PORT='46106';
const{startWorkspace}=await import('./start.mjs');startWorkspace();
