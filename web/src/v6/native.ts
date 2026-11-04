// Host adaptation for the MyGO window: real traffic lights, drag from blank header areas,
// double-click zoom and Command+W closing the front surface first. Nothing here touches data.
import {host} from './store';
declare global{interface Window{OpsTwinsWindowChrome?:{closeFrontSurface:()=>boolean}}}
const interactive='button,input,a,select,textarea,label,summary,[role="button"],[role="switch"],[role="separator"],[contenteditable]:not([contenteditable="false"])';
export const isNative=()=>!!host();
export function installWindowChrome(closeFront:()=>boolean){
 window.OpsTwinsWindowChrome={closeFrontSurface:closeFront};
 if(!host())return()=>{};
 const region=(e:Event)=>{const t=e.target;if(!(t instanceof Element)||t.closest(interactive))return null;return t.closest('[data-drag-region]') as HTMLElement|null;};
 const dbl=(e:MouseEvent)=>{if(e.button===0&&region(e)){e.preventDefault();void host()?.window?.toggleMaximize()}};
 const down=(e:PointerEvent)=>{
  if(e.button!==0)return;const el=region(e);if(!el)return;e.preventDefault();
  const pointer=e.pointerId,start={x:e.screenX,y:e.screenY};let active=true,pending:{x:number;y:number}|null=null,moving=false,origin:{x:number;y:number}|null=null;
  el.setPointerCapture(pointer);
  const flush=async()=>{if(moving||!origin||!active)return;moving=true;try{while(active&&pending){const p=pending;pending=null;await host()!.call('WindowChrome.Move',Math.round(origin.x+p.x-start.x),Math.round(origin.y+p.y-start.y))}}catch{}finally{moving=false}};
  const move=(ev:PointerEvent)=>{if(!active||ev.pointerId!==pointer)return;pending={x:ev.screenX,y:ev.screenY};void flush()};
  const end=(ev:PointerEvent|{pointerId:number})=>{if(ev.pointerId!==pointer)return;active=false;pending=null;el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end as any);el.removeEventListener('pointercancel',end as any);el.removeEventListener('lostpointercapture',end as any);if(el.hasPointerCapture(pointer))el.releasePointerCapture(pointer)};
  el.addEventListener('pointermove',move);el.addEventListener('pointerup',end as any);el.addEventListener('pointercancel',end as any);el.addEventListener('lostpointercapture',end as any);
  host()!.call('WindowChrome.Position').then((v:any)=>{if(!active)return;origin=v;void flush()}).catch(()=>end({pointerId:pointer}));
 };
 document.addEventListener('dblclick',dbl);document.addEventListener('pointerdown',down);
 return()=>{document.removeEventListener('dblclick',dbl);document.removeEventListener('pointerdown',down)};
}
// Signed update flow. The native side owns source, signature and install checks.
export const update={
 status:()=>host()?host()!.call('DesktopUpdate.Status'):Promise.resolve(null),
 check:()=>host()!.call('DesktopUpdate.Check'),
 download:()=>host()!.call('DesktopUpdate.Download'),
 cancel:()=>host()!.call('DesktopUpdate.Cancel'),
 install:()=>host()!.call('DesktopUpdate.Install'),
};
