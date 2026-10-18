// Synchronous storage never awaits consumers; each consumer coalesces after commit.
type Listener=(type:string,id:string)=>void;
const listeners=new Set<Listener>();
export function onEntityChange(listener:Listener){listeners.add(listener);return ()=>listeners.delete(listener)}
export function entityChanged(type:string,id:string){for(const listener of listeners)listener(type,id)}
