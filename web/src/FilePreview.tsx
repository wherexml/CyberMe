import { useI18n, translate } from './domain/i18n';
import {useEffect,useRef,useState} from 'react';
import {Download,X,FileText} from 'lucide-react';
import type {Artifact} from '../../shared/types';
import {MessageBody} from './pages/Chat';
import {api} from './domain/api';

export default function FilePreview({artifacts}:{artifacts:Artifact[]}){ const { t, language } = useI18n();
 const [id,setId]=useState(()=>sessionStorage.getItem('opsadv-preview')||'');
 const [text,setText]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 const origin=useRef<HTMLElement|null>(null),closeButton=useRef<HTMLButtonElement>(null);
 const file=artifacts.find(a=>a.id===id);
 const close=()=>{setId('');origin.current?.focus()};
 useEffect(()=>{sessionStorage.setItem('opsadv-preview',id);document.body.classList.toggle('file-preview-open',!!id);return()=>document.body.classList.remove('file-preview-open')},[id]);
 useEffect(()=>{const click=(event:MouseEvent)=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;const link=(event.target as Element).closest<HTMLAnchorElement>('a[href]');if(!link||link.hasAttribute('download'))return;const url=new URL(link.href,location.href);const a=artifacts.find(a=>new URL(a.url,location.href).href===url.href);if(!a)return;event.preventDefault();origin.current=link;setId(a.id)};document.addEventListener('click',click,true);return()=>document.removeEventListener('click',click,true)},[artifacts]);
 useEffect(()=>{if(!id)return;closeButton.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();close()}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[id]);
 useEffect(()=>{let active=true;setText('');setError('');if(!file){setLoading(false);return}setLoading(true);api.get<{text:string}>(`/artifacts/${encodeURIComponent(file.id)}/preview`).then(result=>{if(active)setText(result.text)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[file?.id,retry]);
 if(!id)return null;
 const mime=file?.mime||'',image=mime.startsWith('image/'),pdf=mime==='application/pdf',media=/^(audio|video)\//.test(mime);
 return <aside className="file-preview" aria-label={t("File preview")}><header><FileText size={18}/><strong title={file?.name}>{file?.name||t("File unavailable")}</strong>{file&&<a className="icon-button" href={file.url} download={file.name} aria-label={t("Download preview file")}><Download size={17}/></a>}<button ref={closeButton} className="icon-button" aria-label={t("Close file preview")} onClick={close}><X size={18}/></button></header><div className="preview-breadcrumb">{t("Chat")} <span>›</span> {file?.name}</div><div className="preview-content">{!file?<p role="alert">{t("This file is no longer available.")}</p>:error?<div role="alert" className="error-inline">{error}<button className="btn" onClick={()=>setRetry(n=>n+1)}>{t("Retry preview")}</button></div>:loading?<p role="status">{t("Loading file…")}</p>:image?<img src={file.url} alt={file.name} onError={()=>setError('Image could not load.')}/>:pdf?<iframe title={file.name} src={`${file.url}#navpanes=0&view=FitH`}/>:media?mime.startsWith('audio/')?<audio controls src={file.url} onError={()=>setError('Audio could not load.')}/>:<video controls src={file.url} onError={()=>setError('Video could not load.')}/>:<>{/wordprocessingml|spreadsheetml|excel/.test(mime)&&<p className="preview-note">{t("Content preview · original formatting is available in the download. Up to 60,000 characters; spreadsheets up to 200 rows × 20 columns per sheet.")}</p>}{/markdown/.test(mime)||/\.md$/i.test(file.name)?<MessageBody text={text.replace(/^# ([^\n]+)\r?\n\s*# \1(?=\r?\n|$)/, '# $1')}/>:<pre>{text}</pre>}</>}</div></aside>
}
