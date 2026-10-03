import {Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, NumberFormat, BorderStyle, TableLayoutType, WidthType, type ParagraphChild, type IRunOptions, type IParagraphOptions, type INumberingOptions} from 'docx';
import {marked} from 'marked';

function clean(value:unknown):string {
  return Array.from(value===null||value===undefined?'':String(value)).map(char=>{const n=char.codePointAt(0)!;return n===9||n===10||n===13||(n>=32&&n<=0xD7FF)||(n>=0xE000&&n<=0xFFFD)||(n>=0x10000&&n<=0x10FFFF)?char:'\uFFFD';}).join('');
}
function entities(value:string){const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};return value.replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,name:string)=>named[name]).replace(/&#(x[0-9a-f]+|\d+);/gi,(raw,n)=>{const value=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);return value>=0&&value<=0x10FFFF?String.fromCodePoint(value):raw;});}
function inline(tokens:any[],format:Partial<IRunOptions>={}):ParagraphChild[]{
  const children:ParagraphChild[]=[];
  for(const token of tokens){
    if(token.type==='strong'||token.type==='em'||token.type==='del'){children.push(...inline(token.tokens||[{type:'text',text:token.text}],{...format,...(token.type==='strong'?{bold:true}:token.type==='em'?{italics:true}:{strike:true})}));continue;}
    if(token.type==='br'){children.push(new TextRun({...format,break:1}));continue;}
    if(token.type==='link'||token.type==='image'){const label=token.text||token.href||'',destination=token.href||'';children.push(new TextRun({...format,text:clean(entities(token.type==='image'?`[Image: ${label}]${destination?` (${destination})`:''}`:label+(destination&&destination!==label?` (${destination})`:'')))}));continue;}
    if(token.type==='codespan'){children.push(new TextRun({...format,text:clean(token.text),font:{ascii:'Courier New',hAnsi:'Courier New',eastAsia:'Heiti SC'},size:20}));continue;}
    if(token.tokens){children.push(...inline(token.tokens,format));continue;}
    children.push(new TextRun({...format,text:clean(entities(token.text??token.raw??''))}));
  }
  return children;
}
function inlineText(value:string):ParagraphChild[]{return inline(marked.Lexer.lexInline(value));}
const headings=[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3,HeadingLevel.HEADING_4,HeadingLevel.HEADING_5,HeadingLevel.HEADING_6];

/**
 * Converts the supplied complete Markdown/plain text into real Office Open XML.
 * Does not fetch remote images, create source facts, truncate the body, or write a file.
 */
export async function renderOperationsDocument(title:string,content:string):Promise<Buffer>{
  const documentTitle=clean(title).trim()||'Operations document';
  const numbering:INumberingOptions['config'][number][]=[];let sequence=0;
  const body:(Paragraph|Table)[]=[new Paragraph({heading:HeadingLevel.TITLE,children:[new TextRun({text:documentTitle,color:'000000'})],spacing:{after:280},keepNext:true})];
  const paragraph=(value:string,options:IParagraphOptions={})=>new Paragraph({children:inlineText(value),spacing:{after:160,line:288},widowControl:true,...options});
  const addBlocks=(tokens:any[],depth=0)=>{
    for(const token of tokens){
      if(token.type==='space')continue;
      if(token.type==='heading'){if(body.length===1&&clean(token.text).trim()===documentTitle)continue;body.push(paragraph(token.text,{heading:headings[Math.min(5,Math.max(0,token.depth-1))],keepNext:true,spacing:{before:260,after:140}}));continue;}
      if(token.type==='paragraph'||token.type==='text'){body.push(paragraph(token.text??token.raw??''));continue;}
      if(token.type==='list'){
        const level=Math.min(8,depth),reference='ops-list-'+sequence++;
        numbering.push({reference,levels:Array.from({length:9},(_,i)=>({level:i,format:token.ordered?NumberFormat.DECIMAL:NumberFormat.BULLET,text:token.ordered?`%${i+1}.`:'•',start:token.ordered&&i===level?Number(token.start)||1:1,alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:420+360*i,hanging:280}}}}))});
        for(const item of token.items||[]){const itemTokens=item.tokens||[];let first=true;for(const block of itemTokens){if(block.type==='list'){addBlocks([block],depth+1);continue;}if(block.type==='space')continue;const source=block.text??block.raw??'';const marker=item.task&&first?(item.checked?'☑ ':'☐ '):'';body.push(paragraph(marker+source,{...(first?{numbering:{reference,level}}:{indent:{left:420+360*level}}),spacing:{after:100,line:288}}));first=false;}if(first)body.push(paragraph((item.task?(item.checked?'☑ ':'☐ '):'')+(item.text||''),{numbering:{reference,level},spacing:{after:100,line:288}}));}
        continue;
      }
      if(token.type==='blockquote'){addBlocks(token.tokens||[{type:'paragraph',text:token.text}],depth);continue;}
      if(token.type==='code'){for(const line of clean(token.text).split('\n'))body.push(new Paragraph({children:[new TextRun({text:line,font:{ascii:'Courier New',hAnsi:'Courier New',eastAsia:'Heiti SC'},size:20})],spacing:{after:50,line:260},widowControl:true}));continue;}
      if(token.type==='table'){
        const data:any[][]=[token.header||[],...(token.rows||[])],columns=Math.max(1,...data.map(row=>row.length));const totalWidth=9638;
        const weights=Array.from({length:columns},(_,i)=>Math.min(50,Math.max(9,...data.map(row=>Array.from(clean(row[i]?.text||'')).length))));const sum=weights.reduce((n,value)=>n+value,0),widths=weights.map(value=>Math.round(value/sum*totalWidth));
        const border={style:BorderStyle.SINGLE,size:4,color:'D9D9D9'};
        const rows=data.map((row,i)=>new TableRow({tableHeader:i===0,children:Array.from({length:columns},(_,j)=>new TableCell({width:{size:widths[j],type:WidthType.DXA},margins:{top:110,bottom:110,left:140,right:140},shading:{fill:i===0?'EDEDF0':i%2===0?'F7F7F8':'FFFFFF'},children:[new Paragraph({children:inline(row[j]?.tokens||marked.Lexer.lexInline(clean(row[j]?.text||'')),i===0?{bold:true,color:'000000'}:{}),spacing:{after:40,line:270},widowControl:true})]}))}));
        body.push(new Table({rows,width:{size:totalWidth,type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border}}));body.push(new Paragraph({text:'',spacing:{after:140}}));continue;
      }
      if(token.type==='hr'){body.push(new Paragraph({text:'',spacing:{after:160}}));continue;}
      if(token.type==='def'){body.push(paragraph(`[${token.tag}]: ${token.href}${token.title?` — ${token.title}`:''}`));continue;}
      // Preserve unfamiliar blocks and literal HTML as readable text rather than discarding them.
      for(const line of clean(token.text??token.raw??'').split('\n'))body.push(new Paragraph({text:line,spacing:{after:100,line:288},widowControl:true}));
    }
  };
  const text=clean(content).replace(/\r\n?/g,'\n');
  if(text.trim())addBlocks(marked.lexer(text,{gfm:true}));else body.push(paragraph('No source content was supplied.'));
  const headingStyle=(size:number)=>({run:{font:{ascii:'Arial',hAnsi:'Arial',eastAsia:'Heiti SC'},size,color:'000000',bold:true},paragraph:{spacing:{before:260,after:140},keepNext:true}});
  const doc=new Document({creator:'OpsTwin Advance',title:documentTitle,description:'Operations content generated from supplied persisted source material',styles:{default:{document:{run:{font:{ascii:'Arial',hAnsi:'Arial',eastAsia:'Heiti SC'},size:22,color:'000000'},paragraph:{spacing:{after:160,line:288}}},title:{run:{font:{ascii:'Arial',hAnsi:'Arial',eastAsia:'Heiti SC'},size:48,color:'000000',bold:true},paragraph:{spacing:{after:280},keepNext:true}},heading1:headingStyle(32),heading2:headingStyle(28),heading3:headingStyle(25),heading4:headingStyle(24),heading5:headingStyle(23),heading6:headingStyle(22)}},numbering:{config:numbering},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},children:body}]});
  return Packer.toBuffer(doc);
}
