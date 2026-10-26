import {draftEligibility,prepareThreadContext} from './vendor/inbox-zero.js';
import {esc,button} from './ui.js';

export const inboxFingerprint=item=>JSON.stringify([item.id,item.title,item.messages,item.judgment,item.draftConfidence]);
export function hydrateInboxExamples(state,initial) {
  for(const item of state.inbox){
    const example=initial.inbox.find(x=>x.id===item.id);
    // Backfill only exact public examples from earlier Mock versions.
    if(!example||JSON.stringify([item.source,item.title,item.messages,item.judgment])!==JSON.stringify([example.source,example.title,example.messages,example.judgment]))continue;
    if(!Object.hasOwn(item,'draftConfidence')&&Object.hasOwn(example,'draftConfidence'))item.draftConfidence=example.draftConfidence;
    if(!Object.hasOwn(item,'previewDraft')&&example.previewDraft)item.previewDraft=example.previewDraft;
    if(!Object.hasOwn(item,'generatedDraft')&&!item.draftRevision&&item.draft===example.generatedDraft)item.generatedDraft=example.generatedDraft;
  }
}
export function prepareInboxDraft(item) {
  const gate=draftEligibility(item.draftConfidence);
  const context=prepareThreadContext(item.messages);
  return {...gate,eligible:gate.eligible&&Array.isArray(item.judgment),context};
}

export function draftFeedback(item) {
  const request=item.draftRequest,candidate=item.draftCandidate;
  const issue=request&&['failed','unknown','partial'].includes(request.status)?`<p class="draft-feedback-error" role="status">${esc(request.error||'结果尚未确认，原草稿已保留')}</p>`:'';
  return issue+(candidate?`<section class="draft-candidate" aria-label="新草稿"><div><span>新草稿</span>${button('采用','adopt-draft','subtle','',request?.status==='completed'?'':'disabled')}${button('关闭','dismiss-draft','subtle')}</div><p>${esc(candidate.text)}</p></section>`:'');
}

export function createInboxDrafts({getState,getUI,save,changed,toast}) {
  let restored=false;
  for(const item of getState().inbox)if(item.draftRequest?.status==='running'){
    item.draftRequest.status='unknown';item.draftRequest.error='上次生成中断，原草稿已保留';restored=true;
  }
  if(restored)save();
  const visible=item=>getUI().page==='inbox'&&getUI().item===item.id;
  const notify=item=>{if(visible(item))changed(item)};
  function apply(item,candidate) {
    if(candidate.sourceFingerprint!==inboxFingerprint(item)){toast('来源已变化，请先核对');return}
    const before=item.draft,previousGenerated=item.generatedDraft,revision=item.draftRevision||0;
    item.draft=candidate.text;item.generatedDraft=candidate.text;item.draftRevision=revision+1;
    const previousCandidate=item.draftCandidate;delete item.draftCandidate;
    if(!save()){
      item.draft=before;item.generatedDraft=previousGenerated;item.draftRevision=revision;item.draftCandidate=previousCandidate||candidate;
      item.draftRequest.status='failed';item.draftRequest.error='保存失败，原草稿已保留';
    }
    notify(item);
  }
  async function generate() {
    const scope=getState(),item=scope.inbox.find(x=>x.id===getUI().item);if(!item)return;
    if(item.draftRequest?.status==='running')return;
    if(['unknown','partial'].includes(item.draftRequest?.status)){toast('先核对原记录，原草稿已保留');return}
    const prepared=prepareInboxDraft(item),sourceFingerprint=inboxFingerprint(item);
    const previous=item.draftRequest;
    const request={id:previous?.status==='failed'&&previous.sourceFingerprint===sourceFingerprint?previous.id:crypto.randomUUID(),status:'running',sourceFingerprint,baseDraft:item.draft||'',baseRevision:item.draftRevision||0,createdAt:new Date().toISOString(),policy:{confidence:prepared.confidence,minimumConfidence:prepared.minimumConfidence,reason:prepared.reason},context:{messageCount:prepared.context.messages.length,truncatedCount:prepared.context.truncatedCount,omittedCount:prepared.context.omittedCount}};
    item.draftRequest=request;
    if(!prepared.eligible){request.status='unknown';request.error=prepared.reason==='low-confidence'?'回复信息不足，原草稿已保留':'回复尚未确认，原草稿已保留';save();notify(item);return}
    const scenario=getUI().scenario;
    if(scenario!=='normal'){
      request.status=scenario==='error'?'failed':scenario==='partial'?'partial':'unknown';request.error=scenario==='error'?'生成未完成，原草稿已保留':'结果尚未确认，原草稿已保留';save();notify(item);return;
    }
    if(!save()){request.status='failed';request.error='记录未保存，尚未开始生成';notify(item);return}
    notify(item);
    // Public local preview, no model, provider, OAuth, or transport is invoked.
    await new Promise(resolve=>setTimeout(resolve,700));
    if(getState()!==scope||!scope.inbox.includes(item)||item.draftRequest!==request)return;
    if(inboxFingerprint(item)!==sourceFingerprint){request.status='unknown';request.error='来源已变化，原草稿已保留';save();notify(item);return}
    const terminalScenario=getUI().scenario;
    if(terminalScenario!=='normal'){
      request.status=terminalScenario==='error'?'failed':terminalScenario==='partial'?'partial':'unknown';request.error='生成未完成，原草稿已保留';save();notify(item);return;
    }
    const text=item.previewDraft;
    if(typeof text!=='string'||!text.trim()){request.status='failed';request.error='没有可用的新草稿';save();notify(item);return}
    request.status='completed';
    const candidate={id:request.id,text,sourceFingerprint};
    item.draftCandidate=candidate;
    if(!save()){request.status='failed';request.error='新草稿未保存，原草稿已保留';notify(item);return}
    // Exact raw comparisons protect even whitespace edits and later typing.
    const unchanged=(item.draft||'')===request.baseDraft&&(item.draftRevision||0)===request.baseRevision;
    const generated=typeof item.generatedDraft==='string'&&item.draft===item.generatedDraft;
    const untouchedEmpty=!item.draft&&!item.generatedDraft&&!item.draftRevision;
    if(unchanged&&(generated||untouchedEmpty))apply(item,candidate);else notify(item);
  }
  return {generate,adopt(){const item=getState().inbox.find(x=>x.id===getUI().item);if(item?.draftCandidate&&item.draftRequest?.status==='completed')apply(item,item.draftCandidate)},dismiss(){const item=getState().inbox.find(x=>x.id===getUI().item);if(!item)return;const before=item.draftCandidate;delete item.draftCandidate;if(!save())item.draftCandidate=before;notify(item)}};
}
