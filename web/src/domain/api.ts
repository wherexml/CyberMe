export class ApiError extends Error { constructor(public status:number,public data:any){super(data?.message||data?.error||`Request failed (${status})`)} }
async function request<T>(path:string,method:string,body?:unknown,options?:RequestInit):Promise<T>{
 const headers=new Headers(options?.headers); if(body!==undefined&&!(body instanceof FormData))headers.set('Content-Type','application/json');
 const url=path.startsWith('/api/')||path==='/api'||path.startsWith('/files/')?path:'/api'+(path.startsWith('/')?path:'/'+path);
 if(window.mygo&&location.pathname==='/pilot.html'&&!(body instanceof FormData)){const r=await window.mygo.call('Bridge.Request',method,url,body??null);if(r.status<200||r.status>=300)throw new ApiError(r.status,r.data);return r.data as T;}
 const res=await fetch(url,{...options,method,headers,credentials:'same-origin',body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 const type=res.headers.get('content-type')||'';const data=type.includes('json')?await res.json():await res.text();if(!res.ok)throw new ApiError(res.status,data);return data as T;
}
export const api={get:<T=any>(path:string,options?:RequestInit)=>request<T>(path,'GET',undefined,options),post:<T=any>(path:string,body?:unknown,options?:RequestInit)=>request<T>(path,'POST',body,options),patch:<T=any>(path:string,body?:unknown)=>request<T>(path,'PATCH',body),put:<T=any>(path:string,body?:unknown)=>request<T>(path,'PUT',body),delete:<T=any>(path:string)=>request<T>(path,'DELETE'),upload:<T=any>(path:string,data:FormData)=>request<T>(path,'POST',data)};
