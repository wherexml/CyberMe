// Narrow loader for ONE fixed product skill (server/agent/skills/insight-visuals). No discovery, no user/developer skills, no tools.
// Read on every generation/review and every projection; its content hash is part of the cache fingerprint.
// Missing, empty or malformed skill fails closed for generation and returns an unavailable marker for reads.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {CODE_ROOT} from './runtime-paths';

export const SKILL_ID='insight-visuals';
const DIR=join(CODE_ROOT,'server','agent','skills',SKILL_ID);
const FILES=['SKILL.md','generate.md','review.md'] as const;
const MAX_BYTES=48*1024;
/** Loader contract version: bump when placeholder handling or composition changes. */
const LOADER='insight-visual-skill-loader-2';
export const REVIEW_CHECKS=['labels','values','attribution','chronology','structure','cross_field'] as const;
export const REVIEW_CODES=['unsupported_value','ambiguous_token','wrong_role','false_mapping','cardinality','identity_mismatch','label_mismatch','attribution','chronology','dropped_qualifier','dropped_negation','fabricated','cross_field','other'] as const;

export interface LoadedSkill{id:string;version:string;hash:string;generate:string;review:string}
export type SkillState={ok:true;skill:LoadedSkill}|{ok:false;error:string};

function readSafe(name:string):string{
 const path=join(DIR,name),st=lstatSync(path,{throwIfNoEntry:false});
 if(!st||st.isSymbolicLink()||!st.isFile())throw Error('skill_file_missing:'+name);
 if(st.size===0||st.size>MAX_BYTES)throw Error('skill_file_size:'+name);
 if(realpathSync(path)!==join(realpathSync(DIR),name))throw Error('skill_file_path:'+name);
 const text=readFileSync(path,'utf8');if(!text.trim())throw Error('skill_file_empty:'+name);
 return text;
}
let cache:{key:string;state:SkillState}|undefined;
/** Load and validate the skill. Re-reads when any file's size/mtime changes; never falls back to an inline prompt. */
export function loadInsightSkill(constants:{version:string;icons:string}):SkillState{
 let key='';
 try{key=FILES.map(f=>{const s=lstatSync(join(DIR,f),{throwIfNoEntry:false});return s?`${f}:${s.size}:${s.mtimeMs}`:`${f}:none`}).join('|')+'|'+constants.version+'|'+constants.icons}catch{key='error'}
 if(cache?.key===key)return cache.state;
 let state:SkillState;
 try{
  const [skill,gen,rev]=FILES.map(readSafe);
  const fm=skill.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);if(!fm)throw Error('skill_front_matter');
  const name=fm[1].match(/^name:\s*(\S+)\s*$/m)?.[1],version=fm[1].match(/^version:\s*(\S+)\s*$/m)?.[1];
  if(name!==SKILL_ID||!version)throw Error('skill_identity');
  const body=fm[2].trim();if(body.length<200)throw Error('skill_body_too_short');
  for(const p of ['{{VERSION}}','{{ICONS}}'])if(!gen.includes(p))throw Error('generate_placeholder:'+p);
  for(const p of ['{{CHECKS}}','{{CHECKS_JSON}}','{{CODES}}'])if(!rev.includes(p))throw Error('review_placeholder:'+p);
  const hash=createHash('sha256').update(JSON.stringify([LOADER,skill,gen,rev])).digest('hex');
  // The header line travels with every model request so audits can prove which skill was sent.
  const header=`[skill ${SKILL_ID}@${version} sha256:${hash}]\n`;
  const fill=(t:string)=>t.replaceAll('{{VERSION}}',constants.version).replaceAll('{{ICONS}}',constants.icons).replaceAll('{{CHECKS_JSON}}',JSON.stringify(REVIEW_CHECKS)).replaceAll('{{CHECKS}}',REVIEW_CHECKS.join(' ')).replaceAll('{{CODES}}',REVIEW_CODES.join(' '));
  state={ok:true,skill:{id:SKILL_ID,version,hash,generate:header+body+'\n\n'+fill(gen),review:header+body+'\n\n'+fill(rev)}};
 }catch(e:any){state={ok:false,error:String(e?.message||'skill_unavailable').split(':')[0]}}
 cache={key,state};return state;
}
