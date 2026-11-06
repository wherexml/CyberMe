import {AsyncLocalStorage} from 'node:async_hooks';

// Only an Agent's active, authorized application read can observe its raw
// response before public redaction. Concurrent HTTP clients never share scope.
const scope=new AsyncLocalStorage<{active:boolean;observe:(value:unknown)=>void}>();
export async function captureExecutionCredentials<T>(observe:(value:unknown)=>void,read:()=>Promise<T>|T){
 const context={active:true,observe};
 try{return await scope.run(context,read)}finally{context.active=false}
}
export function observeExecutionCredentials(value:unknown){
 const context=scope.getStore();if(context?.active)context.observe(value);
}
