/* Wake only jobs started by this extension on supported AI pages. */
(()=>{
 const KEY='workflowAIActivity',leases=new Map();let timer=null,saving=Promise.resolve(),pending=Promise.resolve();
 const supported=value=>!!globalThis.WorkflowAISites?.providerForURL(value);
 const validId=id=>typeof id==='string'&&id.length>0&&id.length<=160;
 const persist=()=>{const records=[...leases].map(([tabId,item])=>({tabId,original:item.original,expires:item.expires,ids:[...item.ids]}));saving=saving.catch(()=>{}).then(()=>chrome.storage.session.set({[KEY]:records}));return saving;};
 const schedule=()=>{if(leases.size&&!timer)timer=setInterval(()=>{pending=pending.catch(()=>{}).then(pulse);},1000);else if(!leases.size&&timer){clearInterval(timer);timer=null;}};
 async function release(tabId){const item=leases.get(tabId);if(!item)return;leases.delete(tabId);schedule();try{await chrome.tabs.update(tabId,{autoDiscardable:item.original});}catch{}await persist();}
 let pulsing=false;
 async function pulse(){if(pulsing)return;pulsing=true;try{for(const [id,item] of [...leases]){try{const tab=await chrome.tabs.get(id);if(!supported(tab.url)||Date.now()>item.expires){await release(id);continue;}const result=await chrome.tabs.sendMessage(id,{type:'WORKFLOW_AI_PULSE'});const active=new Set(result?.activeRequestIds||[]);for(const job of item.ids)if(!active.has(job))item.ids.delete(job);if(!item.ids.size)await release(id);}catch{await release(id);}}}finally{pulsing=false;}}
 const ready=chrome.storage.session.get(KEY).then(async saved=>{for(const item of Array.isArray(saved[KEY])?saved[KEY]:[])if(Number.isInteger(item.tabId)&&typeof item.original==='boolean'&&Number.isFinite(item.expires)&&Array.isArray(item.ids))leases.set(item.tabId,{original:item.original,expires:item.expires,ids:new Set(item.ids.filter(validId))});schedule();if(leases.size)await pulse();}).catch(()=>{});
 // Serialize start/end so a very fast result cannot leave a stale tab lease.
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['WORKFLOW_AI_WATCH_START','WORKFLOW_AI_WATCH_END'].includes(message?.type))return false;
  if(sender.id!==chrome.runtime.id||sender.frameId!==undefined&&sender.frameId!==0||!Number.isInteger(sender.tab?.id)||!supported(sender.url)||!supported(sender.tab.url)||!validId(message.requestId)){respond({ok:false});return false;}
  pending=pending.catch(()=>{}).then(async()=>{await ready;const id=sender.tab.id;
   if(message.type==='WORKFLOW_AI_WATCH_START'){const tab=await chrome.tabs.get(id);if(!supported(tab.url))throw Error('Trang AI đã thay đổi.');let item=leases.get(id);if(!item){item={original:tab.autoDiscardable!==false,ids:new Set(),expires:Date.now()+45*60*1000};leases.set(id,item);}item.ids.add(message.requestId);try{await persist();await chrome.tabs.update(id,{autoDiscardable:false});schedule();}catch(error){await release(id);throw error;}}
   else{const item=leases.get(id);item?.ids.delete(message.requestId);if(item&&!item.ids.size)await release(id);else await persist();}
  });
  pending.then(()=>respond({ok:true}),()=>respond({ok:false}));return true;
 });
 chrome.tabs.onRemoved.addListener(id=>{if(leases.delete(id)){schedule();void persist();}});
})();
