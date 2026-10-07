import React,{useEffect,useRef,useState} from 'react';
import {Bold,Italic,Heading1,Heading2,Heading3,List,ListOrdered} from 'lucide-react';
import type {UIContext} from '../../../../shared/types';
const api=(method:string,path:string,body?:any)=>window.OpsTwinsDesktop.api(method,'/api/settings/documents/'+path,body);
type Document={kind:string;content:string;version:string};
function Markdown({value}:{value:string}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{if(ref.current)(window as any).OpsTwinsMarkdown.render(ref.current,value)},[value]);return <div className="settings-markdown" ref={ref}/>}
function DocumentEditor({kind,ctx}:{kind:string;ctx:UIContext}){
 const textarea=useRef<HTMLTextAreaElement>(null),current=useRef(''),seq=useRef(0);
 const [doc,setDoc]=useState<Document>(),[value,setValue]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const assign=(v:string)=>{current.current=v;setValue(v)};
 async function load(){const gen=++seq.current;setBusy(true);try{const next=await api('GET',kind);if(gen!==seq.current)return;setDoc(next);assign(next.content);setEditing(false);setError('')}catch(e:any){setError(e.message)}finally{if(gen===seq.current)setBusy(false)}}
 useEffect(()=>{void load();return()=>{seq.current++}},[]);
 useEffect(()=>{if(doc&&!editing&&current.current===doc.content)void load()},[ctx.state.revision]);
 function edit(v:string){assign(v);setNotice('')}
 async function save(){if(!doc||busy)return;setBusy(true);setError('');const submitted=current.current;try{const saved=await api('PATCH',kind,{content:submitted,version:doc.version});setDoc(saved);if(current.current===submitted){assign(saved.content);setEditing(false)}setNotice('已保存');void ctx.refresh().catch(()=>{})}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function rebase(){setBusy(true);try{const next=await api('GET',kind);setDoc(next);setError('');setNotice('已读取最新版本，当前输入保留。请核对后保存。')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 function format(before:string,after=''){const el=textarea.current;if(!el)return;const a=el.selectionStart,b=el.selectionEnd;edit(value.slice(0,a)+before+value.slice(a,b)+after+value.slice(b));requestAnimationFrame(()=>{el.focus();el.setSelectionRange(a+before.length,b+before.length)})}
 return <section className="settings-document markdown-document" data-document={kind}>
 <header className="settings-document-header"><strong>{kind==='soul'?'SOUL.md':'MEMORY.md'}</strong><div className="document-actions">{editing?<><button disabled={busy} onClick={()=>setEditing(false)}>预览</button><button disabled={busy||!doc} onClick={save}>{busy?'保存中…':'保存'}</button></>:<button disabled={busy||!doc} onClick={()=>{setEditing(true);setNotice('')}}>编辑</button>}</div></header>
 {error&&<div role="alert"><p>{error}</p><button disabled={busy} onClick={rebase}>读取最新版本，保留输入</button><button disabled={busy} onClick={()=>load()}>放弃输入，读取最新</button></div>}{notice&&<p role="status">{notice}</p>}
 {!doc?<p>正在读取文档…</p>:editing?<><div className="markdown-toolbar" role="toolbar" aria-label="Markdown 格式">{[{label:'加粗',before:'**',after:'**',Icon:Bold},{label:'斜体',before:'*',after:'*',Icon:Italic},{label:'一级标题',before:'# ',Icon:Heading1},{label:'二级标题',before:'## ',Icon:Heading2},{label:'三级标题',before:'### ',Icon:Heading3},{label:'项目列表',before:'- ',Icon:List},{label:'编号列表',before:'1. ',Icon:ListOrdered}].map(({label,before,after,Icon})=><button type="button" key={label} aria-label={label} title={label} onMouseDown={e=>e.preventDefault()} onClick={()=>format(before,after)}><Icon size={18} aria-hidden="true"/></button>)}</div><textarea ref={textarea} aria-label={kind==='soul'?'身份 Markdown':'记忆 Markdown'} className="markdown-source" value={value} onChange={e=>edit(e.target.value)} spellCheck={false}/></>:<Markdown value={value|| (kind==='soul'?'尚未填写身份。':'尚无长期记忆。你可以直接编辑，或在对话中告诉我需要记住的内容。')}/>}
 </section>
}
export default function Identity({ctx}:{ctx:UIContext}){return <section className="desktop-identity"><h1>身份与记忆</h1><DocumentEditor kind="soul" ctx={ctx}/><DocumentEditor kind="memory" ctx={ctx}/></section>}
