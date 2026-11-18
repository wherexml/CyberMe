// Host adaptation for the MyGO window: real traffic lights, drag from blank header areas,
// double-click zoom and Command+W closing the front surface first. Nothing here touches data.
import {host} from './store';
declare global{interface Window{OpsTwinsWindowChrome?:{closeFrontSurface:()=>boolean}}}
const interactive='button,input,a,select,textarea,label,summary,[role="button"],[role="switch"],[role="separator"],[contenteditable]:not([contenteditable="false"])';
export const isNative=()=>!!host();
export const desktopNotifications={
 status:()=>host()!.call('DesktopNotifications.Status'),
 configure:(enabled:boolean,version:string)=>host()!.call('DesktopNotifications.Configure',enabled,version),
 test:()=>host()!.call('DesktopNotifications.Test'),
 takeOpen:()=>host()!.call('DesktopNotifications.TakeOpen') as Promise<string>,
};
export function installWindowChrome(closeFront:()=>boolean){
 window.OpsTwinsWindowChrome={closeFrontSurface:closeFront};
 if(!host())return()=>{};
 // MyGO forwards these regions to AppKit's performWindowDragWithEvent:.
 // One native drag owns the gesture, including display origins/scales and release.
 // Its mousedown handler also owns double-click zoom; do not toggle a second time.
 const style=document.createElement('style');
 style.dataset.windowChrome='native';
 style.textContent=`[data-drag-region]{--app-region:drag;user-select:none}
 [data-drag-region] :is(${interactive}),[data-drag-region] :is(${interactive}) *{--app-region:no-drag}`;
 document.head.append(style);
 return()=>style.remove();
}
// Signed update flow. The native side owns source, signature and install checks.
export const update={
 status:()=>host()?host()!.call('DesktopUpdate.Status'):Promise.resolve(null),
 check:()=>host()!.call('DesktopUpdate.Check'),
 download:()=>host()!.call('DesktopUpdate.Download'),
 cancel:()=>host()!.call('DesktopUpdate.Cancel'),
 install:()=>host()!.call('DesktopUpdate.Install'),
};
