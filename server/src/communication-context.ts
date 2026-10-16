/** Keep newest evidence first when allocating a bounded chronological context. */
export function communicationMessages(value:any,limit=60,budget=18000){
 const rows=Array.isArray(value)?value:[];let remaining=budget,contentTruncated=false;
 const messages=rows.slice(-limit).reverse().map((m:any)=>{
  const raw=m.deleted||m.recalled?'':String(m.text||m.content||m.body||''),text=raw.slice(0,Math.min(1500,remaining));remaining-=text.length;contentTruncated ||= text.length<raw.length;
  return {id:m.id,replyToId:m.replyToId,deleted:m.deleted,recalled:m.recalled,text,isMine:m.isMine,direction:m.direction,senderId:m.senderId,sender:m.senderName,sentAt:m.sentAt,createdAt:m.createdAt};
 }).reverse();
 return {messages,coverage:{available:rows.length,loaded:messages.length,truncated:rows.length>limit||contentTruncated}};
}
