/** Read-only list preview. Transport envelopes stay unchanged in stored messages. */
export function wechatPreviewText(value:unknown):string {
 const text=typeof value==='string'?value:'';
 let payload:any;try{payload=JSON.parse(text)}catch{return text}
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==1)return text;
 const [kind]=Object.keys(payload),content=payload[kind];
 if(kind==='Text'&&typeof content==='string')return content;
 const labels:Record<string,string>={Link:'[链接]',File:'[文件]',Image:'[图片]',Voice:'[语音]',Video:'[视频]',Sticker:'[表情]',Quote:'[引用消息]',Location:'[位置]',Contact:'[名片]'};
 if(!labels[kind])return text;
 const field=(...keys:string[])=>keys.map(k=>content?.[k]).find(v=>typeof v==='string'&&v.trim());
 return field('title','file_name','name','reply_text','des','description')||labels[kind];
}
export function inboxListPreview(item:any):string {
 if(item.sourceSystem!=='wechat-sync')return String(item.summary||item.body||item.title||'');
 const latest=(item.messages||[]).filter((m:any)=>!m.deleted&&!m.recalled&&m.text?.trim()).at(-1);
 return wechatPreviewText(latest?.text||item.summary||item.body||item.title||'');
}
