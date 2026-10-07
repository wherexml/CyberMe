(() => {
 const panel=document.createElement('details');panel.id='mygo-qualification';
 const summary=document.createElement('summary');summary.textContent='公开离线资格验证';panel.append(summary);
 const out=document.createElement('output');panel.append(out);
 let stream, generation=0;
 function stop(){generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;out.textContent='音轨已释放'}
 function button(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=()=>Promise.resolve().then(fn).catch(()=>out.textContent='操作失败，请检查权限或运行环境');panel.append(b)}
 button('验证麦克风',async()=>{stop();const owner=generation;out.textContent='等待麦克风权限（最多15秒）';const timer=setTimeout(()=>{if(owner===generation){stop();out.textContent='麦克风请求超时；迟到音轨将丢弃'}},15000);try{const next=await navigator.mediaDevices.getUserMedia({audio:true});if(owner!==generation){next.getTracks().forEach(t=>t.stop());return}stream=next;out.textContent=stream.getAudioTracks().some(t=>t.readyState==='live')?'真实麦克风音轨已启动':'没有有效音轨'}finally{clearTimeout(timer)}});
 button('停止麦克风',stop);
 button('文件选择（只验证取消，不读取）',async()=>{out.textContent=await window.mygo.call('Qualification.ChooseFile')});
 button('记录窗口状态',async()=>{const state=await window.mygo.call('Qualification.State');out.textContent=JSON.stringify(state)});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
 window.addEventListener('pagehide',stop);
 window.mygo?.on('owner-hidden',stop);
 button('检查WebView能力',()=>{out.textContent=JSON.stringify({secure:isSecureContext,mediaDevices:!!navigator.mediaDevices,mediaRecorder:!!window.MediaRecorder,origin:location.origin})});document.body.append(panel);
 // This qualification has no authenticated business bridge; model/send actions cannot execute.
})();
