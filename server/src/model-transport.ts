// Effective transport for one internal generator only. The saved model configuration is never changed.
// insight_visual needs strict JSON. The official DeepSeek Anthropic-compatible endpoint ignores JSON mode,
// while the same origin's OpenAI-compatible Chat Completions supports response_format json_object for the same model.
// Applies ONLY to: kind insight_visual, https://api.deepseek.com/anthropic(/), anthropic-messages (or default), literal deepseek-* model.
export const JSON_TRANSPORT_KINDS=new Set(['insight_visual']);
export function effectiveTransport<T extends {baseUrl:string;api?:string;model?:string}|undefined>(config:T,kind?:string):T{
 if(!config||!kind||!JSON_TRANSPORT_KINDS.has(kind))return config;
 let u:URL;try{u=new URL(config.baseUrl)}catch{return config}
 const official=u.protocol==='https:'&&u.hostname==='api.deepseek.com'&&!u.port&&!u.username&&!u.password&&!u.search&&/^\/anthropic\/?$/.test(u.pathname);
 const anthropic=(config.api||'anthropic-messages')==='anthropic-messages';
 const deepseekModel=typeof config.model==='string'&&/^deepseek-[a-z0-9.\-]+$/i.test(config.model);
 if(!official||!anthropic||!deepseekModel)return config;
 // Same origin, account, model and options; only the protocol path changes.
 return {...config,baseUrl:'https://api.deepseek.com',api:'openai-completions'};
}
