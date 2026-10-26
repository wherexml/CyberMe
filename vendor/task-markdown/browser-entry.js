import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
const parser=unified().use(remarkParse).use(remarkGfm);
// Source offsets come from the real GFM syntax tree, including nested lists.
// Code examples and repeated labels cannot shift a checkbox onto another line.
export function taskMarkers(source){
 const markers=[];
 const walk=node=>{if(node.type==='listItem'&&typeof node.checked==='boolean'){
  const start=node.position?.start?.offset;
  if(Number.isSafeInteger(start)){const match=/^(?:[-+*]|\d+[.)])\s+\[([ xX])\]/.exec(source.slice(start));if(match)markers.push({offset:start+match[0].lastIndexOf('[')+1,checked:node.checked})}
 }for(const child of node.children||[])walk(child)};
 walk(parser.parse(String(source)));return markers;
}
