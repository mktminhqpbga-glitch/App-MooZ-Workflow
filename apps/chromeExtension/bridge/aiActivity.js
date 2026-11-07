/* Per-request background collection. Never focuses a tab or sends a prompt. */
(()=>{
 if(globalThis.WorkflowAIActivity)return;
 const jobs=new Set(),waiting=new Set();let observer;
 const notify=(type,requestId)=>{try{const sent=chrome.runtime.sendMessage?.({type,requestId});sent?.catch?.(()=>{});}catch{}};
 const wake=()=>{for(const finish of [...waiting])finish();};
 function start(id){if(!id||jobs.has(id))return;jobs.add(id);notify('WORKFLOW_AI_WATCH_START',id);if(!observer){observer=new MutationObserver(wake);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['src','srcset','href','data-video-src','data-video-url','data-download-url','aria-busy','data-is-streaming','data-state']});}}
 function finish(id){if(!jobs.delete(id))return;notify('WORKFLOW_AI_WATCH_END',id);if(!jobs.size){observer?.disconnect();observer=null;wake();}}
 function wait(ms,signal){return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('Đã dừng.','AbortError'));return;}
  let timer,done=false;
  const end=()=>{if(done)return;done=true;clearTimeout(timer);waiting.delete(end);signal?.removeEventListener('abort',abort);resolve();};
  const abort=()=>{if(done)return;done=true;clearTimeout(timer);waiting.delete(end);signal?.removeEventListener('abort',abort);reject(new DOMException('Đã dừng.','AbortError'));};
  waiting.add(end);timer=setTimeout(end,ms);signal?.addEventListener('abort',abort,{once:true});
 });}
 async function sleep(ms,signal){const deadline=Date.now()+ms;do{await wait(Math.max(1,deadline-Date.now()),signal);}while(Date.now()<deadline);}
 // Read current-turn data even when Chromium skips layout outside the viewport.
 // Explicitly hidden content remains excluded.
 function readable(el){if(!el?.isConnected)return false;for(let node=el;node instanceof Element;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;}return true;}
 function text(el){if(!el)return '';const copy=el.cloneNode(true),originals=[...el.querySelectorAll('*')],clones=[...copy.querySelectorAll('*')];originals.forEach((node,i)=>{const style=getComputedStyle(node);if(node.matches('button,header,[role="toolbar"],script,style,template,[hidden],[aria-hidden="true"]')||style.display==='none'||style.visibility==='hidden')clones[i].remove();});copy.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));for(const node of copy.querySelectorAll('p,div,li,pre,blockquote,h1,h2,h3,tr'))node.append('\n');return String(copy.textContent||'').trim();}
 async function image(src,signal){
  let response;try{response=await fetch(src,{credentials:'include',signal});}catch(error){
   if(signal?.aborted||new URL(src,location.href).origin===location.origin)throw error;
   // Public image CDNs often send Access-Control-Allow-Origin: *; that response
   // cannot be read with credentials. Retry the same URL without cookies.
   response=await fetch(src,{credentials:'omit',signal});
  }
  if(!response.ok)throw Error('Không tải được ảnh AI: HTTP '+response.status);const blob=await response.blob();if(!blob.size||blob.size>50*1024*1024||!blob.type.startsWith('image/'))throw Error('Ảnh AI chưa sẵn sàng hoặc vượt giới hạn 50 MB.');const bitmap=await createImageBitmap(blob);try{if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40000000)throw Error('Kích thước ảnh AI không hợp lệ.');return {blob,width:bitmap.width,height:bitmap.height};}finally{bitmap.close();}
 }
 for(const event of ['load','loadedmetadata','visibilitychange'])document.addEventListener(event,wake,true);
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(sender.id!==chrome.runtime.id||message?.type!=='WORKFLOW_AI_PULSE')return false;wake();respond({ok:true,activeRequestIds:[...jobs]});return false;});
 globalThis.WorkflowAIActivity={version:2,start,finish,wait,sleep,wake,readable,text,image};
})();
