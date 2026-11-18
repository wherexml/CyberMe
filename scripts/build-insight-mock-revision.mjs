import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const commonEntry=root+'.local/design-preview/v6.1-concept.html';
const source=root+'.local/design-preview/v6-baseline-20261111.html';
const expectedBaseline='5277901d4f80f425c41494c44192dc347f8c69e77aa8c17de52a223cbb7727ee';
let html;
try{html=await readFile(source,'utf8')}catch(error){
 if(error.code!=='ENOENT')throw error;
 html=await readFile(commonEntry,'utf8');
 if(createHash('sha256').update(html).digest('hex')!==expectedBaseline)throw Error('Common entry is no longer the verified baseline; restore the frozen source first');
 await writeFile(source,html,{flag:'wx'});
}
const baselineHash=createHash('sha256').update(html).digest('hex');
if(baselineHash!==expectedBaseline)throw Error('Frozen V6 baseline changed; refusing to publish');
const once=(from,to)=>{if(html.split(from).length!==2)throw Error('Expected one source anchor: '+from.slice(0,100));html=html.replace(from,to)};
once('<head>','<head>\n<title>CyberMe V6 · 洞察入口迭代</title>');
once('<span>{{ t.sim }}</span>','<a href="http://127.0.0.1:46400/#overview" style="text-decoration:none">← 返回导航</a><span style="color:var(--text3)">V6 · 洞察入口迭代 · 合成数据</span>');
once('state = Object.assign({dir:\'quiet\', lang:\'en\', vw:window.innerWidth}, seed(false));','state = Object.assign({dir:\'quiet\', lang:\'zh\', vw:window.innerWidth}, seed(false), mockRevisionSeed(false));');
once('this.setState(seed(empty), () =>','this.setState({...seed(empty),...mockRevisionSeed(empty)}, () =>');
once('  renderVals(){','  renderV6BaselineVals(){');
once('  baseVals(){','  renderVals(){return mockRevisionValues(this,this.renderV6BaselineVals())}\n\n  baseVals(){');
const logic=await readFile(root+'mock/opstwins/v6-revision/logic.js','utf8');
once('class Component extends DCLogic {',logic+'\nclass Component extends DCLogic {');
const sub='<div style="display:flex;justify-content:center;margin:-6px 0 -6px"><div style="display:flex;gap:2px;padding:2px;border-radius:var(--r-btn);background:var(--segBg)"><sc-for list="{{ br.subTabs }}" as="sb"><button onClick="{{ sb.onClick }}" style="{{ sb.style }}">{{ sb.label }}</button></sc-for></div></div>';
once(sub,'');
const journalStart=html.indexOf('              <div style="display:flex;flex-direction:column;gap:6px;margin-top:14px">');
const journalEnd=html.indexOf('          <sc-if value="{{ showToday }}"',journalStart);
if(journalStart<0||journalEnd<0)throw Error('Journal anchors missing');
html=html.slice(0,journalStart)+'              </div>\n              </sc-if>\n            </div>\n          </sc-if>\n'+html.slice(journalEnd);
const goneStart=html.indexOf('                <sc-if value="{{ g.gone }}">'),goneEnd=html.indexOf('                </sc-if>',goneStart);
if(goneStart<0||goneEnd<0)throw Error('Gallery history anchor missing');
html=html.slice(0,goneStart)+html.slice(goneEnd+'                </sc-if>'.length);
once('<span style="font-size:12px;font-weight:500;color:var(--text2)">{{ g.kind }}</span>','');
once('<div style="flex:1;min-height:0;overflow-y:auto;padding:8px 20px 32px;box-sizing:border-box">','<div data-mock-panel-scroll="" style="flex:1;min-height:0;overflow-y:auto;padding:8px 20px 32px;box-sizing:border-box">');
once('          <sc-if value="{{ showBrief }}"',`          <sc-if value="{{ mockShowEmpty }}"><div style="padding:60px 0;text-align:center;font-size:13px;color:var(--text3)">{{ mockEmptyText }}</div></sc-if>
          <sc-if value="{{ showBrief }}"`);
// One quiet footer row at the end of the feed; the history list expands inline below it.
once('          <sc-if value="{{ showTaskList }}"',`          <sc-if value="{{ mockShowFooter }}"><div data-mock-footer="" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 0 0">
            <div style="display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:2px;font-size:12px;color:var(--text3)">
              <button data-mock-refresh="" onClick="{{ mockRefresh }}" disabled="{{ mockSearching }}" style="height:28px;padding:0 8px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--text2);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap" style-hover="background:var(--hover);color:var(--text)">{{ mockRefreshLabel }}</button>
              <sc-if value="{{ mockHasHistory }}"><span aria-hidden="true">·</span><button data-mock-history-toggle="" onClick="{{ mockToggleHistory }}" aria-expanded="{{ mockHistoryExpanded }}" aria-controls="mock-history" style="height:28px;padding:0 8px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--text2);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap" style-hover="background:var(--hover);color:var(--text)">{{ mockHistoryLabel }}</button></sc-if>
            </div>
            <sc-if value="{{ mockStatus }}"><div data-mock-status="" role="status" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text3)"><span>{{ mockStatusText }}</span><sc-if value="{{ mockFailed }}"><button data-mock-retry="" onClick="{{ mockRefresh }}" style="height:28px;padding:0 10px;border:0;border-radius:var(--r-sm);font:inherit;font-size:12px;background:transparent;cursor:pointer;white-space:nowrap;color:var(--accentText)" style-hover="background:var(--hover)">{{ mockRetryLabel }}</button></sc-if></div></sc-if>
            <sc-if value="{{ mockHistoryOpen }}"><div id="mock-history" data-mock-history="" role="list" aria-label="{{ mockHistoryLabel }}" style="align-self:stretch;margin-top:4px;border-top:0.5px solid var(--line)"><sc-for list="{{ mockHistoryRows }}" as="row"><div role="listitem" data-mock-history-row="{{ row.key }}" data-state="{{ row.state }}" aria-busy="{{ row.busyAttr }}" style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:0.5px solid var(--line)">
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><span style="font-size:13px;line-height:1.45;color:var(--text);text-wrap:pretty">{{ row.title }}</span><span data-mock-row-status="" style="font-size:12px;color:var(--text3)">{{ row.status }}</span><sc-if value="{{ row.hasNote }}"><span data-mock-row-note="" style="{{ row.noteStyle }}">{{ row.note }}</span></sc-if></div>
              <sc-if value="{{ row.canIgnore }}"><button data-mock-ignore-local="{{ row.key }}" onClick="{{ row.onIgnore }}" disabled="{{ row.busy }}" style="height:28px;padding:0 10px;border:0;border-radius:var(--r-sm);font:inherit;font-size:12px;background:transparent;cursor:pointer;white-space:nowrap;color:var(--text2)" style-hover="background:var(--hover)">{{ mockIgnoreLabel }}</button></sc-if>
              <button data-mock-restore="{{ row.key }}" onClick="{{ row.onRestore }}" disabled="{{ row.busy }}" style="height:28px;padding:0 10px;border:0;border-radius:var(--r-sm);font:inherit;font-size:12px;background:transparent;cursor:pointer;white-space:nowrap;color:var(--accentText)" style-hover="background:var(--hover)">{{ mockRestoreLabel }}</button>
            </div></sc-for></div></sc-if>
          </div></sc-if>
          <sc-if value="{{ showTaskList }}"`);
once('<sc-for list="{{ br.decs }}" as="dq" hint-placeholder-count="3">\n                <div','<sc-for list="{{ br.decs }}" as="dq" hint-placeholder-count="3">\n                <div data-mock-decision="{{ dq.mockKey }}"');
once('<div style="{{ g.cardStyle }}"','<div data-mock-idea="{{ g.mockKey }}" style="{{ g.cardStyle }}"');
once('<button onClick="{{ dq.onLater }}"','<button data-mock-snooze="{{ dq.mockKey }}" onClick="{{ dq.onLater }}"');
once('<button onClick="{{ dq.onDiscuss }}"','<button data-mock-discuss="{{ dq.mockKey }}" onClick="{{ dq.onDiscuss }}"');
once('<button onClick="{{ g.onLater }}"','<button data-mock-ignore="{{ g.mockKey }}" onClick="{{ g.onLater }}"');
once('{{ x.notNow }}</button>\n                    <button onClick="{{ g.onCall }}"','{{ mockIgnoreLabel }}</button>\n                    <button onClick="{{ g.onCall }}"');
// Use local copies of fonts/icons already bundled with the product; reference layout stays intact.
once('https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css','v6-assets/regular/style.css');
once('https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css','v6-assets/fill/style.css');
const fontLink='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">';
once(fontLink,'');
once('<style>',`<style>
@font-face{font-family:"IBM Plex Sans";font-weight:400 600;font-display:swap;src:url("v6-assets/IBMPlexSans-latin.woff2") format("woff2")}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`);
const output=root+'.local/design-preview/insights-current.html';
await writeFile(output,html);
await writeFile(commonEntry,html);
const {cp}=await import('node:fs/promises');
await mkdir(root+'.local/design-preview/v6-assets',{recursive:true});
await cp(root+'web/src/v6/vendor/phosphor/regular',root+'.local/design-preview/v6-assets/regular',{recursive:true});
await cp(root+'web/src/v6/vendor/phosphor/fill',root+'.local/design-preview/v6-assets/fill',{recursive:true});
await cp(root+'web/src/v6/vendor/fonts/IBMPlexSans-latin.woff2',root+'.local/design-preview/v6-assets/IBMPlexSans-latin.woff2');
const metadata={source,baselineHash,output,commonEntry,revisionHash:createHash('sha256').update(html).digest('hex'),scope:'Existing V6 prototype plus feed footer (refresh, inline ignored/snoozed list) and simulation controls; common URL mirrors the current Mock; synthetic only.'};
await writeFile(root+'.local/design-preview/insights-current-source.json',JSON.stringify(metadata,null,2));
console.log(JSON.stringify(metadata,null,2));
