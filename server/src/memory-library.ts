import {peopleContext} from './people-context';
import {list} from './store';

// Read-only projection. The source Wiki remains authoritative and is never rewritten by browsing.
export function memoryPeople(){
 const context=peopleContext(),tracking=list('memories').filter(m=>m.kind==='person_tracking');
 return {
  owner:{name:context.owner.name,aliases:context.owner.aliases,role:context.owner.role||'',about:context.owner.about||''},
  incomplete:context.coverage.unavailable.length>0,
  people:context.people.map(p=>({id:p.id,name:p.name,aliases:p.aliases,role:p.role,relationship:p.relationship,reviewedAt:p.reviewedAt,markdown:p.markdown,truncated:p.truncated,
   observations:tracking.filter(m=>m.personId===p.id).flatMap(m=>(m.observations||[]).map((o:any)=>({key:o.key,summary:o.summary,kind:o.kind,eventAt:o.eventAt||null,evidence:(o.evidence||[]).map((e:any)=>({sourceId:e.sourceId,messageId:e.messageId||null,quote:e.quote,actor:e.actor,eventAt:e.eventAt||null}))})))
  }))
 };
}
