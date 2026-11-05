/* Cancellation-aware waiting and FIFO ownership of a provider tab. */
(() => {
 const aborted=()=>new DOMException('Đã dừng.','AbortError');
 function waitFor(promise,signal){
  if(signal?.aborted)return Promise.reject(aborted());
  if(!signal)return Promise.resolve(promise);
  return new Promise((resolve,reject)=>{const stop=()=>finish(reject,aborted());const finish=(fn,value)=>{signal.removeEventListener('abort',stop);fn(value);};signal.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));});
 }
 function queue(){
  const tails=new Map();
  return {async acquire(key,signal,onWait){
   const previous=tails.get(key)||Promise.resolve();let release;const gate=new Promise(resolve=>{release=resolve;});const tail=previous.then(()=>gate);const waiting=tails.has(key);tails.set(key,tail);void tail.then(()=>{if(tails.get(key)===tail)tails.delete(key);});
   try{if(waiting)onWait?.();await waitFor(previous,signal);if(signal?.aborted)throw aborted();return release;}catch(error){release();throw error;}
  }};
 }
 function pause(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){reject(aborted());return;}const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(aborted());},timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);signal?.addEventListener('abort',stop,{once:true});});}
 function pacer(interval=5000,{now=()=>Date.now(),sleep=pause}={}){
  const mutex=queue(),completed=new Map();let started=-Infinity;
  return {async wait(key,signal,onWait){const release=await mutex.acquire('dispatch',signal,()=>onWait?.(interval));try{const remaining=Math.max(started+interval,(completed.get(key)??-Infinity)+interval)-now();if(remaining>0){onWait?.(remaining);await sleep(remaining,signal);}if(signal?.aborted)throw aborted();started=now();let done=false;return ()=>{if(!done){done=true;completed.set(key,now());}};}finally{release();}}};
 }
 function tabUsage(nodes,provider,tabs,defaults={},busy=new Set()){
  const counts=new Map(tabs.map(tab=>[tab.id,{id:tab.id,count:0,busy:0}]));
  for(const node of nodes){if(!['generateImage','generateVideo','generateText','masterScript'].includes(node.type))continue;const actual=node.data?.provider||(['generateText','masterScript'].includes(node.type)?'gemini':'muse');if(actual!==provider)continue;const target=node.data?.chatTarget||defaults[provider]||(tabs.length===1?{tabId:tabs[0].id}:null),entry=counts.get(target?.tabId);if(entry){entry.count++;if(busy.has(node.id))entry.busy++;}}
  return [...counts.values()];
 }
 globalThis.WorkflowRuntime={waitFor,queue,pacer,tabUsage};
})();
