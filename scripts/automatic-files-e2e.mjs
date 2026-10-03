/** Retired behavior: run the removal regression instead, with the TS loader. */
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--import','tsx',new URL('./remove-automatic-files-e2e.mjs',import.meta.url).pathname],{stdio:'inherit'});
process.exitCode=result.status??1;
