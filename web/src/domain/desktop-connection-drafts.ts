// Public form fields only. Credentials and arbitrary protocol headers never enter drafts.
const KEY='opstwins-full-connections';
const configFields=['authMethod','scopes','importantPeople','urgentWords','workingHoursOnly','workFrom','workUntil','workDays','timezone','syncInterval','includeAttachments','filter'];
export function desktopConnectionDraft(id:string):any {
 if(!window.OpsTwinsDesktop)return undefined;
 try{return JSON.parse(localStorage.getItem(KEY)||'{}')[id]}catch{return undefined}
}
export function saveDesktopConnectionDraft(id:string,value:any){
 if(!window.OpsTwinsDesktop)return;
 const all=JSON.parse(localStorage.getItem(KEY)||'{}');
 if(!value)delete all[id];else{
  let endpoint=value.endpoint||'';try{const u=new URL(endpoint);if(u.username||u.password||u.search||u.hash)endpoint=''}catch{}
  const config=Object.fromEntries(configFields.filter(k=>value.config?.[k]!==undefined).map(k=>[k,value.config[k]]));
  all[id]={type:value.type,name:value.name,endpoint,auth:value.auth,permissions:value.permissions,config,baseline:value.baseline};
 }
 localStorage.setItem(KEY,JSON.stringify(all));
}
