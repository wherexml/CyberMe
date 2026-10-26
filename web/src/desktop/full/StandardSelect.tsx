import React,{forwardRef,useLayoutEffect,useRef,useCallback} from 'react';
// Web keeps its native control; the packaged desktop uses the shared VMSelect.
export const StandardSelect=forwardRef<HTMLSelectElement,React.SelectHTMLAttributes<HTMLSelectElement>>(function StandardSelect(props,forwarded){
 const ref=useRef<HTMLSelectElement>(null);
 useLayoutEffect(()=>{if((window as any).OPSTWINS_DESKTOP_MODE&&ref.current)(window as any).OpsTwinsSelects?.attach(ref.current)});
 const assignRef=useCallback((node:HTMLSelectElement|null)=>{ref.current=node;if(typeof forwarded==='function')forwarded(node);else if(forwarded)forwarded.current=node},[forwarded]);
 return <span className={(window as any).OPSTWINS_DESKTOP_MODE?'desktop-standard-select':'native-select-wrapper'} style={{display:'contents'}}><select {...props} ref={assignRef}/></span>;
});
