import { DatabaseSync } from 'node:sqlite';
import { realpathSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import {SOURCE_DATA} from './runtime-paths';
const root=SOURCE_DATA;
/** Resolve only attachment descriptors already indexed by the sibling, inside its data root. */
export function sourceMessageAsset(messageId:string,fileKey:string) {
 const source=new DatabaseSync(resolve(root,'dev.db'),{readOnly:true});
 try {
  const row=source.prepare('SELECT payload FROM feishu_messages WHERE id=?').get(messageId) as any;
  const attachment=row&&JSON.parse(row.payload).local_attachments?.find((a:any)=>a.file_key===fileKey);
  if(!attachment?.stored_path)return undefined;
  // Older snapshots retain todo-en paths; resolve the copied cache under opstwin.
  let path:string;
  const original=String(attachment.stored_path);
  if(isAbsolute(original)&&original.startsWith(root+sep))path=realpathSync(original);
  else path=realpathSync(resolve(root,'feishu-attachments',messageId,basename(original)));
  if(!path.startsWith(realpathSync(root)+sep))return undefined;
  return {bytes:readFileSync(path),name:String(attachment.name||fileKey),mime:String(attachment.mime_type||'application/octet-stream')};
 } finally {source.close();}
}
