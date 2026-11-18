// Synthetic reviewed cache for tests of delivery policy, independent of model transport.
import assert from 'node:assert/strict';
import {db,now} from '../../server/src/store.ts';
import {visualFingerprint,visualInput,visualStatus} from '../../server/src/insight-visuals.ts';
import {graphHash,refsHash} from '../../server/src/insight-visual-review.ts';
import {validateInsightGraph} from '../../shared/insight-visual.ts';

export function seedApprovedInsight(idea){
 const refs=visualInput(idea);
 const quote=refs.E0.slice(0,70);
 const spec={version:'insight-visual-v1',relation:'quote',blocks:[{type:'quote',line:{text:quote,status:'quote',basis:[{ref:'E0',quote}]}}]};
 const validation=validateInsightGraph(spec,refs);
 assert.ok(validation.valid,JSON.stringify(validation.errors));
 const fingerprint=visualFingerprint(idea),skillHash=visualStatus().skill.hash,at=now();
 assert.ok(skillHash);
 const data={ideaId:idea.id,fingerprint,status:'ready',attempts:1,calls:2,updatedAt:at,generatedAt:at,spec,
  review:{verdict:'pass',graphHash:graphHash(spec),refsHash:refsHash(refs),skillHash,at}};
 db.prepare('INSERT OR REPLACE INTO insight_visuals(idea_id,fingerprint,status,data,updated_at) VALUES(?,?,?,?,?)').run(idea.id,fingerprint,'ready',JSON.stringify(data),at);
 return idea;
}
