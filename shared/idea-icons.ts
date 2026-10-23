import catalog from './idea-icon-catalog.json';
export const ideaIconCatalog = catalog;
const keys=new Set(catalog.map(icon=>icon.id));
export const validIdeaIcon=(key:unknown):key is string=>typeof key==='string'&&keys.has(key);
export function resolveIdeaIcon(idea:{iconKey?:unknown;id?:string;title?:string},previous?:unknown):string {
 if(validIdeaIcon(idea.iconKey))return idea.iconKey;
 if(validIdeaIcon(previous))return previous;
 let seed=2166136261;for(const char of String(idea.id||idea.title||'idea'))seed=Math.imul(seed^char.codePointAt(0)!,16777619)>>>0;
 return catalog[seed%catalog.length]!.id;
}
export const ideaIconInstruction='为每项建议选择一个最贴合核心主题的 iconKey，只能从以下图标目录选择。不要按类别机械套用或为了不同而选择不相关图标；不要返回SVG、URL或自造标识。图标仅用于展示，不改变事实、状态或操作权限。\n'+catalog.map(x=>`${x.id}：${x.label}（${x.keywords}）`).join('\n');
