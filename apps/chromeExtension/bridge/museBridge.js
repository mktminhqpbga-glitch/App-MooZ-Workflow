(() => {
  if (window.__museFlowBridgeInstalled) return;
  window.__museFlowBridgeInstalled = true;
  window.__museFlowBridgeVersion=chrome.runtime.getManifest?.()?.version||'1.0.0';
  const activity=globalThis.WorkflowAIActivity;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if(_sender.id!==chrome.runtime.id)return false;
    if(message?.type==='WORKFLOW_AI_SEND_NOW'||message?.type==='WORKFLOW_AI_USE_RESULT'){
      const state=textStates.get(message.requestId);if(!state){sendResponse({ok:false});return false;}
      if(message.type==='WORKFLOW_AI_SEND_NOW')state.early=true;
      else{if(typeof message.text!=='string'||!message.text.trim()||message.text.length>100000){sendResponse({ok:false});return false;}state.manual=message.text.trim();}
      sendResponse({ok:true});return false;
    }
    if (message?.type === 'MUSEFLOW_CHECK_SESSION') {
      checkSession().then(sendResponse,error=>sendResponse({ok:false,error:error.message||String(error)}));
      return true;
    }
    if(message?.type==='MUSEFLOW_JOB_STATUS'){
      activity?.wake?.();const job=museJobs.get(message.requestId);
      const answer=()=>{const {retryItems,...wire}=job.result||{};sendResponse({ok:true,state:job.result?'done':'running',progress:job.progress||'',...(job.result?{result:wire}:{})});};
      if(!job){sendResponse({ok:false,state:'missing'});return false;}
      if(job.result?.retryItems){job.result.retryItems().then(result=>{job.result={...job.result,...result};answer();},()=>answer());return true;}
      answer();return false;
    }
    if(message?.type==='MUSEFLOW_JOB_ACK'){if(museJobs.get(message.requestId)?.result)museJobs.delete(message.requestId);sendResponse({ok:true});return false;}
    if(message?.type==='MUSEFLOW_JOB_START'){
      const id=message.requestId;if(typeof id!=='string'||!id){sendResponse({ok:false,error:'Thiếu mã tác vụ.'});return false;}
      if(museJobs.has(id)){sendResponse({ok:true,accepted:true,requestId:id});return false;}
      if(activeGenerations.size){sendResponse({ok:false,code:'TAB_BUSY',error:'Muse đang xử lý yêu cầu khác.'});return false;}
      for(const [key,job] of museJobs)if(job.result&&Date.now()-(job.finishedAt||job.createdAt)>1200000)museJobs.delete(key);
      const completed=[...museJobs].filter(([,job])=>job.result);while(completed.length>=3)museJobs.delete(completed.shift()[0]);
      const controller=new AbortController(),job={createdAt:Date.now(),result:null};museJobs.set(id,job);activeGenerations.set(id,controller);activity?.start(id);
      generate(message,controller.signal).then(result=>{job.result={...result,requestId:id,...(result.ok&&message.mediaType==='video'?{videoResultProtocol:1}:{}),conversationUrl:location.href,receipt:{requestId:id,requestCode:message.requestCode,sentTurnMatchesRequestId:result.nativeReceipt===true}};job.finishedAt=Date.now();},error=>{job.finishedAt=Date.now();job.result={ok:false,code:error.code||'MUSE_ERROR',error:error.message||String(error),block:error.block};}).finally(()=>{activeGenerations.delete(id);textStates.delete(id);activity?.finish(id);});
      sendResponse({ok:true,accepted:true,requestId:id});return false;
    }
    if (message?.type === 'MUSEFLOW_GENERATE') {
      if(activeGenerations.size){sendResponse({ok:false,code:'TAB_BUSY',error:'Muse đang xử lý yêu cầu khác.'});return false;}
      const controller=new AbortController();activeGenerations.set(message.requestId,controller);activity?.start(message.requestId);
      generate(message,controller.signal).then(result=>sendResponse({...result,requestId:message.requestId,...(result.ok&&message.mediaType==='video'?{videoResultProtocol:1}:{}),conversationUrl:location.href}), error => sendResponse({ ok: false, code:error.code||'MUSE_ERROR', error: error.message || String(error),block:error.block })).finally(()=>{activeGenerations.delete(message.requestId);textStates.delete(message.requestId);activity?.finish(message.requestId);});
      return true;
    }
    if(message?.type==='MUSEFLOW_STOP_GENERATION'){
      const stopped=message.requestId?abortGeneration(message.requestId):[...activeGenerations.keys()].some(id=>abortGeneration(id));
      sendResponse({ok:true,stopped});return false;
    }
  });

  function findComposer() {
    const candidates=[...document.querySelectorAll('textarea')].filter(el=>(visible(el)||activity&&readable(el))&&!el.disabled);
    return candidates.find(el=>/message|消息/i.test(el.getAttribute('placeholder')||''))||candidates[0]||null;
  }

  function composerScope(el){return WorkflowComposer.scopeFor(el);}

  function visible(el) { return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }
  const readable=el=>activity?activity.readable(el):visible(el);
  const delay = (ms,signal) => activity?activity.sleep(ms,signal):new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('Generation stopped by user.','AbortError'));return;}
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
    const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(new DOMException('Generation stopped by user.','AbortError'));};
    signal?.addEventListener('abort',cancel,{once:true});
  });
  const assistantSelector='[class*="hatch-chat-groupable-bubble"],[data-message-author-role="assistant"],[data-testid*="assistant" i],[data-testid*="message-content" i],[class*="assistant-message" i],[class*="assistant-bubble" i],.group\\/msg';
  const attachmentSelector='[data-testid^="hatch-chat-attachment-presentation-"]';
  const activeGenerations=new Map(),museJobs=new Map(),textStates=new Map();

  function clickMuseStop(){
    const button=[...document.querySelectorAll('[data-testid="hatch-composer-stop-button"],button[aria-label*="Stop" i],button[aria-label*="停止"]')].find(readable);
    if(button){button.click();return true;}return false;
  }

  function abortGeneration(requestId){
    const controller=activeGenerations.get(requestId);
    if(!controller)return false;
    controller.abort();clickMuseStop();return true;
  }

  async function checkSession() {
    const block=WorkflowComposer.serviceState();if(block)return {ok:false,sendProtocol:1,block,composer:false,signedIn:false,busy:false};
    await waitHydrated(5000);
    const composer=findComposer();
    const ready=Boolean(composer&&readable(composer)&&!composer.disabled&&!composer.readOnly);
    const loginRequired=Boolean(document.querySelector('input[type="password"],button[type="submit"]'))&&/sign in|log in|登录/i.test(document.body?.innerText||'');
    return {ok:true,nativeProtocol:1,sendProtocol:1,jobProtocol:1,bridgeProtocol:1,resultProtocol:2,videoResultProtocol:1,textProtocol:1,modeProtocol:1,videoReferenceProtocol:1,backgroundProtocol:activity?(activity.version||1):0,visibility:document.visibilityState,focused:document.hasFocus(),mediaMode:composerMode(),bridgeVersion:window.__museFlowBridgeVersion,signedIn:ready&&!loginRequired,busy:activeGenerations.size>0||[...document.querySelectorAll('[data-testid="hatch-composer-stop-button"],button[aria-label*="Stop" i]')].some(readable),title:document.title,composer:ready,loginRequired,url:location.href};
  }

  function modeName(value){
    const label=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').trim().toLowerCase().replace(/\s+/g,' ');
    if(/^(?:(?:create|generate|tao)\s+)?(?:an?\s+)?(?:image|images|photo|photos|anh)(?:\s+(?:generation|mode))?$/.test(label))return 'image';
    if(/^(?:(?:create|generate|tao)\s+)?(?:a\s+)?(?:video|videos)(?:\s+(?:generation|mode))?$/.test(label))return 'video';return 'unknown';
  }
  function modeOf(el){return modeName(el?.getAttribute('aria-label')||el?.getAttribute('title')||el?.textContent);}
  const usableMode=el=>!el.matches(':disabled,[aria-disabled="true"]')&&!(el instanceof HTMLButtonElement&&el.form&&el.type==='submit');
  function modeUI(){
    const scope=composerScope(findComposer());if(!scope)return {scope:null,selects:[],buttons:[],triggers:[]};
    const usable=el=>readable(el)&&!el.closest('[aria-hidden="true"],[data-message-author-role],[class*="hatch-chat-groupable-bubble"],'+attachmentSelector);
    const selects=[...scope.querySelectorAll('select')].filter(el=>usable(el)&&['image','video'].every(type=>[...el.options].some(o=>modeOf(o)===type)));
    const buttons=[...scope.querySelectorAll('[role="tab"],[role="radio"],button[aria-pressed]')].filter(el=>usable(el)&&modeOf(el)!=='unknown');
    const triggers=[...scope.querySelectorAll('[aria-haspopup="menu"],[aria-haspopup="listbox"]')].filter(el=>usable(el)&&modeOf(el)!=='unknown');return {scope,selects,buttons,triggers};
  }
  function composerMode(){
    const ui=modeUI(),selected=ui.buttons.filter(el=>el.getAttribute('aria-selected')==='true'||el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-pressed')==='true');
    const modes=[...ui.selects.map(el=>modeOf(el.selectedOptions[0])),...selected.map(modeOf),...ui.triggers.map(modeOf)].filter(m=>m!=='unknown');return new Set(modes).size===1?modes[0]:'unknown';
  }
  async function ensureComposerMode(type,signal,requestId,request){
    if(type==='text')return;const current=composerMode();if(current===type)return;
    const ui=modeUI(),assert=()=>{WorkflowComposer.assertService(request);if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');};
    const fail=()=>{const error=Error((current!=='unknown'?'Tab Muse đang chọn chế độ '+(current==='video'?'Video':'Ảnh')+'. ':'')+'Không xác nhận được Muse đã chọn '+(type==='image'?'Tạo ảnh':'Tạo video')+'. Chọn chế độ trên Muse hoặc gán tab riêng cho loại kết quả này; chưa gửi yêu cầu mới.');error.code='MUSE_MODE_MISMATCH';throw error;};
    const targets=ui.buttons.filter(el=>usableMode(el)&&modeOf(el)===type);let changed=false;
    assert();
    if(ui.selects.length===1&&!targets.length){const select=ui.selects[0];if(!usableMode(select))fail();const options=[...select.options].filter(o=>modeOf(o)===type&&!o.disabled);if(options.length!==1)fail();select.value=options[0].value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));changed=true;}
    else if(!ui.selects.length&&targets.length===1){targets[0].click();changed=true;}
    else if(!ui.selects.length&&!targets.length&&ui.triggers.length===1){
      const trigger=ui.triggers[0];if(!usableMode(trigger))fail();const menus=()=>[...new Set([...(trigger.getAttribute('aria-controls')||'').split(/\s+/).map(id=>document.getElementById(id)).filter(Boolean),...(trigger.id?[...document.querySelectorAll('[role="menu"],[role="listbox"]')].filter(el=>(el.getAttribute('aria-labelledby')||'').split(/\s+/).includes(trigger.id)):[])])].filter(readable);
      if(!menus().length){trigger.click();for(let i=0;i<20&&!menus().length;i++){assert();await delay(100,signal);}}
      const options=menus().flatMap(menu=>[...menu.querySelectorAll('[role="option"],[role="menuitemradio"],[role="menuitem"]')]).filter(el=>readable(el)&&usableMode(el)&&modeOf(el)===type);
      if(options.length!==1)fail();assert();options[0].click();changed=true;
    }
    // Free-form Muse chat has no explicit mode control. Keep its static/video
    // request contract; never guess an unrelated menu or button in history.
    if(!changed){if(current!=='unknown'||ui.selects.length||ui.buttons.length||ui.triggers.length)fail();return;}
    report(requestId,'Muse: đang chuyển sang '+(type==='image'?'Tạo ảnh':'Tạo video')+'…');
    for(let i=0;i<30;i++){assert();if(composerMode()===type)return;await delay(100,signal);}fail();
  }
  async function waitHydrated(timeout,signal) {
    const end=Date.now()+timeout;
    while(Date.now()<end){
      const hydration=document.querySelector('[data-hatch-shell-hydration-state]');
      if(document.readyState==='complete'&&findComposer()&&(!hydration||hydration.getAttribute('data-hatch-shell-hydration-state')==='hydrated'))return;
      if(signal?.aborted)throw new DOMException('Generation stopped by user.','AbortError');
      await delay(120,signal);
    }
    if(!findComposer())throw new Error('Muse chat is not ready. Open the Muse chat page and wait for the message box to load.');
  }

  function attachments(acceptUnknown=null) {
    const composer=findComposer(),scope=composer&&composerScope(composer);
    const candidates=new Set(document.querySelectorAll(attachmentSelector));
    const tile=el=>el.closest(`${attachmentSelector},figure,[data-video-src],[data-video-url],[data-download-url]`)||el;
    for(const el of document.querySelectorAll('video,[data-video-src],[data-video-url],[data-download-url],a[download],a[href]')){
      if(el.matches('video,[data-video-src],[data-video-url]')||/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(el.href||el.getAttribute('download')||el.getAttribute('data-download-url')||''))candidates.add(tile(el));
    }
    for(const img of document.querySelectorAll('img'))if(activity||img.naturalWidth>=128&&img.naturalHeight>=128)candidates.add(tile(img));
    const found=new Map();
    for(const el of candidates){
      if(!(readable(el)||getComputedStyle(el).display==='contents'&&[...el.querySelectorAll('video,img,a')].some(readable))||el.closest('[data-testid*="placeholder" i],[data-testid*="loading" i],[data-state="loading"],[aria-busy="true"]')||(scope?.contains(el)&&!(el.compareDocumentPosition(composer)&Node.DOCUMENT_POSITION_FOLLOWING))||el.closest('[class*="chat-user-bubble"],[data-message-author-role="user"],user-query,[data-testid="hatch-composer-placeholder-overlay"]'))continue;
      const tid=el.getAttribute('data-testid')||'',video=el.matches('video')?el:el.querySelector('video'),image=el.matches('img')?el:el.querySelector('img');
      const nodes=[el,...el.querySelectorAll('a[href],source[src],[data-video-src],[data-video-url],[data-download-url]')];
      const urls=nodes.map(item=>({url:item.getAttribute('data-video-src')||item.getAttribute('data-video-url')||item.getAttribute('data-download-url')||item.href||item.src||'',download:item.getAttribute('download')||'',type:item.getAttribute('type')||'',explicitVideo:item.hasAttribute('data-video-src')||item.hasAttribute('data-video-url')})).filter(item=>item.url);
      const videoLink=urls.find(item=>item.explicitVideo||/video\//i.test(item.type)||/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(item.url)||/\.(mp4|webm|mov|m4v)$/i.test(item.download))?.url||'';
      const videoUrl=video?.currentSrc||video?.src||video?.querySelector('source')?.src||video?.getAttribute('data-src')||video?.querySelector('source[data-src]')?.getAttribute('data-src')||videoLink||'';
      const src=videoUrl||image?.currentSrc||image?.src||'';
      // Muse wraps the bubble inside the attachment presentation, not always outside it.
      const media=video||image,bubble=media?.closest(assistantSelector)||el.closest(assistantSelector);
      if(media?.closest('[class*="chat-user-bubble"],[data-message-author-role="user"],user-query'))continue;
      const decorative=/(?:^|[\/_.-])(?:placeholder|loading|loader|mascot|avatar|sloth|welcome|onboarding)(?:[\/_.?-]|$)/i.test(src);
      if(src&&(bubble||acceptUnknown?.(media||el))&&!decorative)found.set(src,{el,media:media||el,bubble,tid,src,videoUrl,isVideo:!!videoUrl||!!video||/video/i.test(tid),width:video?.videoWidth||image?.naturalWidth||0,height:video?.videoHeight||image?.naturalHeight||0});
    }
    return [...found.values()];
  }

  let lastScan=null;
  window.WorkflowMuseBridgeDiagnostics=()=>({lastScan,mode:{selected:composerMode(),selects:modeUI().selects.length,buttons:modeUI().buttons.map(modeOf),menus:modeUI().triggers.length},visibility:document.visibilityState,version:window.__museFlowBridgeVersion,activeJobs:activeGenerations.size,trackedJobs:museJobs.size,recognizedAttachments:attachments().length,assistantContainers:assistantMessageElements().length});

  function waitForAttachmentChange(timeoutMs,signal){
    if(activity)return activity.wait(timeoutMs,signal);
    return new Promise(resolve=>{
      let timer;
      const observer=new MutationObserver(()=>finish());
      const finish=()=>{observer.disconnect();clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};
      observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','poster','href','download','type','data-testid','data-video-src','data-video-url','data-download-url']});
      timer=setTimeout(finish,timeoutMs);
      signal?.addEventListener('abort',finish,{once:true});
    });
  }

  function assistantMessageElements(){
    return [...document.querySelectorAll(assistantSelector)].filter(el=>readable(el)&&!el.closest('[class*="chat-user-bubble"],[data-message-author-role="user"],[data-testid*="user-message" i]'));
  }

  function readNewAssistantContext(previousBubbleTexts){
    const bubbles=assistantMessageElements();
    // Muse wraps assistant replies in group containers too; excluding every group/msg
    // ancestor accidentally filtered out the refusal text that should trigger retry.
    const messages=bubbles.map(el=>({el,text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim()})).filter(item=>item.text&&item.text!==previousBubbleTexts.get(item.el));
    return messages.map(item=>item.text).join('\n').slice(-6000);
  }

  function isRefusalContext(context){
    const text=String(context||'');
    const explicit=/(?:i|we)\s+(?:am\s+)?sorry[\s\S]{0,180}(?:cannot|can't|unable|won't)|(?:cannot|can't|couldn't|unable to|not able to)\s+(?:help|assist|create|generate|make|produce|fulfill|complete|comply)|(?:request|prompt).{0,100}(?:violat|disallowed|restricted|not allowed)|(?:policy|safety).{0,100}(?:prevent|restrict|unable)|generation (?:was )?(?:declined|blocked)|content (?:is )?not allowed|i can't comply/i;
    const inability=/(?:không tạo được|không thể tạo|chưa thể tạo|không thực hiện được|vẫn không tạo được|không làm được)/i;
    const sceneContext=/(?:cảnh|bản|đoạn|video|ảnh|nội dung|yêu cầu|này)/i;
    const offerAlternative=/(?:bản|phiên bản|phương án)\s+tương\s+đương|tương\s+đương.{0,100}(?:bám|theo|kịch bản)|muốn.{0,100}(?:tạo mới|thử lại|làm lại)|(?:would you like|do you want|want me to).{0,100}(?:create|make|generate|try)|equivalent alternative/i;
    return explicit.test(text)||inability.test(text)&&(sceneContext.test(text)||offerAlternative.test(text));
  }

  function report(requestId,text){const job=museJobs.get(requestId);if(job)job.progress=text;if(chrome.runtime.sendMessage)void chrome.runtime.sendMessage({type:'WORKFLOW_AI_PROGRESS',requestId,text}).catch(()=>{});}

  async function generate(request,signal) {
    let {prompt,rules='',stageBeforeSend=false,timeoutSec=600,mediaType='image',referenceImage='',referenceImages=[],referenceVideos=[],size='1:1',requestId}=request;
    await WorkflowComposer.waitTurn(request,'prepare',signal,text=>report(requestId,text));
    const throwIfAborted=()=>{WorkflowComposer.assertService(request);if(signal?.aborted)throw new DOMException('Generation stopped by user.','AbortError');};
    throwIfAborted();
    if(!String(prompt||'').trim())throw new Error('Prompt is empty.');
    if(!['text','image','video'].includes(mediaType))throw Error('Muse không hỗ trợ loại kết quả này.');

    await waitHydrated(15000,signal);
    await ensureComposerMode(mediaType,signal,requestId,request);
    if(mediaType!=='text')prompt=[mediaType==='image'?'LOẠI KẾT QUẢ BẮT BUỘC: tạo một ẢNH TĨNH (image), không tạo video hoặc ảnh động.':'LOẠI KẾT QUẢ BẮT BUỘC: tạo một VIDEO có thể phát/tải về.',rules,prompt].filter(Boolean).join('\n\n');
    if(document.hidden)report(requestId,'Muse: tab đang ở nền. App tiếp tục gửi và theo dõi dữ liệu của lượt này.');
    const receiptTag='WF-'+mediaType.toUpperCase()+'-'+crypto.randomUUID();
    if(mediaType==='text')textStates.set(requestId,{early:false,manual:''});
    prompt=[`Mã lượt: ${receiptTag}. Không nhắc lại mã trong câu trả lời.`,mediaType==='text'?rules:'',prompt].filter(Boolean).join('\n\n');
    try{const saved=await chrome.storage?.local?.get('workflowMuseSendTarget');WorkflowComposer.setPreferred(saved?.workflowMuseSendTarget);}catch{WorkflowComposer.setPreferred(null);}
    await waitHydrated(15000,signal);
    throwIfAborted();
    let composer=findComposer();
    if(!(visible(composer)||activity&&readable(composer)))throw new Error('Muse message box is not visible. Open the chat composer and retry.');
    const draftSetter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
    if(draftSetter){draftSetter.call(composer,'');composer.dispatchEvent(new Event('input',{bubbles:true}));}
    const removeDraft=()=>WorkflowComposer.removeButtons(composerScope(findComposer()),findComposer());
    removeDraft().forEach(button=>button.click());
    for(let i=0;i<50&&removeDraft().length;i++)await delay(100,signal);
    if(removeDraft().length)throw new Error('Không xóa được tệp cũ trong Muse. Xóa tệp trong ô chat trước khi chạy lại.');
    const referenceList=Array.isArray(referenceImages)&&referenceImages.length?referenceImages:referenceImage?[referenceImage]:[];
    let referenceFingerprints=new Set();
    if(referenceList.length||referenceVideos.length){report(requestId,'Muse: đang tải tệp tham chiếu…');referenceFingerprints=await attachReferences([...referenceList,...referenceVideos],signal,referenceVideos.length>0,request);}
    if(mediaType==='text'&&textStates.get(requestId)?.manual)return {ok:true,nativeReceipt:newReceipts().some(el=>el.textContent.includes('[MOOZ_REQUEST:'+request.requestCode+']')),text:textStates.get(requestId).manual};
    composer=findComposer();if(!composer?.isConnected)throw new Error('Ô nhập Muse đã thay đổi. Hãy tải lại tab Muse rồi thử lại.');
    throwIfAborted();
    const baseline=new Set([...attachments().map(a=>a.src),...[...document.querySelectorAll('img,video,source,a[download],[data-video-url],[data-video-src]')].flatMap(el=>[el.currentSrc,el.src,el.href,el.getAttribute('data-video-url'),el.getAttribute('data-video-src')]).filter(Boolean),...assistantMessageElements().flatMap(el=>[...el.querySelectorAll('img')].map(img=>img.currentSrc||img.src))]);
    const initialConversation=location.origin+location.pathname;
    const priorBubbleTexts=new Map(assistantMessageElements().map(el=>[el,(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim()]));
    composer.scrollIntoView({block:'center'});composer.focus();
    const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
    if(!setter)throw new Error('Muse message box is unsupported.');
    setter.call(composer,String(prompt));
    composer.dispatchEvent(new Event('input',{bubbles:true}));
    composer.dispatchEvent(new Event('change',{bubbles:true}));
    const bubbleCount=()=>new Set(document.querySelectorAll('div[class*="hatch-chat-groupable-bubble"],[data-message-author-role],user-query,[class*="chat-user-bubble"]')).size;
    const userSelector='[data-message-author-role="user"],user-query,[class*="chat-user-bubble"]';
    const userSnapshot=new Map([...document.querySelectorAll(userSelector)].map(el=>[el,(el.innerText||el.textContent||'').trim()]));
    const promptText=String(prompt).replace(/\s+/g,' ').trim();
    const matchesReceipt=text=>text.includes(promptText)||receiptTag&&text.includes(receiptTag)&&text.includes(promptText.slice(0,Math.min(160,promptText.length)));
    // A reply container can be reused, or already exist as an empty streaming shell.
    // Only unlock it when a new user receipt containing THIS prompt precedes the media.
    const followsReceipt=item=>[...document.querySelectorAll(userSelector)].some(el=>{
      const text=(el.innerText||el.textContent||'').trim(),normalized=text.replace(/\s+/g,' ');
      return readable(el)&&text!==userSnapshot.get(el)&&normalized.includes(promptText)&&!el.contains(item.el)&&Boolean(el.compareDocumentPosition(item.el)&Node.DOCUMENT_POSITION_FOLLOWING);
    });
    const normalize=text=>String(text||'').replace(/\s+/g,' ').trim();
    const promptReceipts=()=>{
      const editor=findComposer(),scope=editor&&composerScope(editor);
      const eligible=el=>!el.contains(editor)&&!scope?.contains(el)&&!el.closest('[data-testid="hatch-composer-placeholder-overlay"]')&&(readable(el)||getComputedStyle(el).display==='contents'&&[...el.querySelectorAll('p,div,span')].some(readable));
      // A sent user bubble can include file labels and controls after the prompt.
      // Their length does not make the actual prompt receipt disappear.
      const known=[...document.querySelectorAll(userSelector)].filter(el=>eligible(el)&&matchesReceipt(normalize(el.textContent)));
      const fallback=[...document.querySelectorAll('div,p,span,article,[role="listitem"]')].filter(el=>{
        if(!eligible(el)||el.closest(userSelector)||el.closest('[data-message-author-role="assistant"]'))return false;
        const text=normalize(el.textContent);return matchesReceipt(text)&&text.length<=promptText.length+40&&![...el.children].some(child=>matchesReceipt(normalize(child.textContent)));
      });
      return [...known,...fallback].filter((el,_,all)=>!all.some(other=>other!==el&&el.contains(other))).sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    };
    let oldReceipts=new Set(promptReceipts());
    const newReceipts=()=>{
      const receipts=promptReceipts();
      // Remounting old turns replaces their elements. For repeated prompts the
      // matching turn count must increase too; element identity alone is unsafe.
      return receipts.slice(oldReceipts.size).filter(el=>!oldReceipts.has(el));
    };
    // Fallback for a new UI without assistant classes. A source URL alone is never enough:
    // the exact current prompt must have a new receipt, and the media must follow it
    // in the same conversation root, before the composer (never a page/footer video).
    const contextualReply=(el,knownAssistant=false)=>{
      // A refreshed historical URL or remounted bubble is not a new result.
      // Use the LAST current prompt receipt, never an earlier matching history turn.
      const receipt=newReceipts().at(-1);if(!receipt)return false;
      // Muse can use the same visual bubble class for the sent prompt and its
      // reference thumbnails. Those thumbnails remain user input, even as blob URLs.
      const userBubble=receipt.closest(userSelector)||receipt.closest('[class*="hatch-chat-groupable-bubble"],[data-testid*="user-message" i]');
      if(userBubble?.contains(el))return false;
      const editor=findComposer();let root=receipt.closest('main,[role="main"]');if(!root){root=receipt.parentElement;while(root&&!root.contains(editor))root=root.parentElement;}
      return root&&root.contains(el)&&!el.contains(receipt)&&Boolean(receipt.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)&&editor&&(knownAssistant||Boolean(el.compareDocumentPosition(editor)&Node.DOCUMENT_POSITION_FOLLOWING));
    };
    const nextUserTurn=()=>{const current=newReceipts().at(-1);if(!current)return null;return [...document.querySelectorAll(userSelector)].find(user=>user!==current&&!user.contains(current)&&!current.contains(user)&&readable(user)&&normalize(user.textContent)&&Boolean(current.compareDocumentPosition(user)&Node.DOCUMENT_POSITION_FOLLOWING));};
    let assignedConversation=initialConversation,conversationAssigned=false,pendingConversation='';const assertCurrentConversation=()=>{const current=location.origin+location.pathname;if(current===assignedConversation)return;if(!conversationAssigned&&['/','/chat','/chat/','/chat/new'].includes(new URL(initialConversation).pathname)&&(!pendingConversation||pendingConversation===current)){pendingConversation=current;if(newReceipts().length){assignedConversation=current;conversationAssigned=true;}return;}const error=Error('Cuộc trò chuyện Muse đã đổi. Không lấy video/ảnh từ chat khác; kiểm tra lượt vừa gửi trước khi thử lại.');error.code='MUSE_CHAT_CHANGED';throw error;};
    const assertCurrentTurn=()=>{if(nextUserTurn()){const error=Error('Muse đã có tin nhắn mới sau yêu cầu của node. App không lấy kết quả của lượt khác và không gửi lại prompt.');error.code='MUSE_TURN_CHANGED';throw error;}};
    const beforeSendCount=bubbleCount(),previousTexts=new Set(priorBubbleTexts.values());
    const sendActivity=()=>!!findComposer()&&!findComposer().value.trim()&&(bubbleCount()>beforeSendCount||newReceipts().length>0||attachments().some(item=>!baseline.has(item.src))||assistantMessageElements().some(el=>{const text=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();return text&&!previousTexts.has(text);})||[...document.querySelectorAll('[data-testid="hatch-composer-stop-button"],button[aria-label*="Stop" i],button[aria-label*="停止"]')].some(readable));
    report(requestId,'Muse: đã điền prompt, đang chờ nút Gửi…');
    if(mediaType==='text'&&stageBeforeSend){const readyAt=Date.now()+120000;let second=-1;while(Date.now()<readyAt&&!textStates.get(requestId)?.early&&!sendActivity()){
      throwIfAborted();if(textStates.get(requestId)?.manual)return {ok:true,nativeReceipt:newReceipts().some(el=>el.textContent.includes('[MOOZ_REQUEST:'+request.requestCode+']')),text:textStates.get(requestId).manual};if(location.origin+location.pathname!==initialConversation)throw Error('Cuộc trò chuyện Muse đã đổi trước khi gửi.');
      const remaining=Math.ceil((readyAt-Date.now())/1000);if(remaining!==second){second=remaining;report(requestId,`Muse: tệp đã sẵn sàng. Tự gửi sau ${remaining} giây; có thể bấm Gửi ngay.`);}await delay(200,signal);
    }}
    let sendButton=null,submitted=false,keyboardSend=false;
    for(let i=0;i<900;i++){
      throwIfAborted();
      if(mediaType==='text'&&textStates.get(requestId)?.manual)return {ok:true,nativeReceipt:newReceipts().some(el=>el.textContent.includes('[MOOZ_REQUEST:'+request.requestCode+']')),text:textStates.get(requestId).manual};
      // A user may press Send while our selector is still waiting. Never send twice.
      if(sendActivity()){submitted=true;break;}
      WorkflowComposer.assertUpload(composerScope(findComposer()));
      sendButton=WorkflowComposer.findSend(composerScope(findComposer()));
      if(sendButton)break;
      const scope=composerScope(findComposer());
      if(i>=30&&!scope.querySelector('[role="progressbar"],[aria-busy="true"],button:disabled,[aria-disabled="true"]')){keyboardSend=true;break;}
      await delay(100,signal);
    }
    throwIfAborted();
    if(!submitted){
      let permit;
      do{
        permit=await WorkflowComposer.waitTurn(request,'permit',signal,text=>report(requestId,text));
        if(sendActivity()){submitted=true;break;}
        throwIfAborted();WorkflowComposer.assertUpload(composerScope(findComposer()));
        if(location.origin+location.pathname!==initialConversation)throw Error('Cuộc trò chuyện Muse đã đổi trong lúc chờ. Chưa gửi yêu cầu.');
        if(String(findComposer()?.value||'').replace(/\s+/g,' ').trim()!==promptText)throw Error('Prompt Muse đã thay đổi trong lúc chờ. Chưa gửi yêu cầu.');
        sendButton=WorkflowComposer.findSend(composerScope(findComposer()));
        if(!sendButton&&!keyboardSend)throw Error('Nút Gửi Muse chưa sẵn sàng sau khi chờ lượt. Chưa gửi yêu cầu.');
        await ensureComposerMode(mediaType,signal,requestId,request);
        if(location.origin+location.pathname!==initialConversation||String(findComposer()?.value||'').replace(/\s+/g,' ').trim()!==promptText)throw Error('Muse đã đổi ô chat hoặc bản nháp khi chuyển chế độ. Chưa gửi yêu cầu; kiểm tra lại tệp tham chiếu.');
        WorkflowComposer.assertUpload(composerScope(findComposer()));
        for(const item of attachments())baseline.add(item.src);
        for(const el of assistantMessageElements())priorBubbleTexts.set(el,(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim());
        oldReceipts=new Set(promptReceipts());
      }while(permit.expiresAt<=Date.now());
      if(!submitted){
        if(sendButton){sendButton.click();report(requestId,'Muse: đã bấm Gửi, đang xác nhận…');}
        else{const input=findComposer();input.focus();for(const type of ['keydown','keyup'])input.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));report(requestId,'Muse: đã yêu cầu gửi bằng Enter, đang xác nhận…');}
        submitted=true;await WorkflowComposer.sent(request);
      }
    }
    let accepted=false;
    for(let i=0;i<150;i++){throwIfAborted();if(sendActivity()){accepted=true;break;}await delay(100,signal);}
    if(!accepted)throw new Error('Chưa xác nhận Muse nhận prompt. Không tự gửi lại để tránh trùng lặp.');
    report(requestId,mediaType==='text'?'Muse đã nhận yêu cầu. Đang chờ văn bản của lượt này…':'Muse đã nhận yêu cầu. Đang tìm video/ảnh kết quả mới…');
    const deadline=Date.now()+Math.min(900,Math.max(30,Number(timeoutSec)||600))*1000;
    if(mediaType==='text'){
      let last='',stableSince=Date.now(),conversation=location.origin+location.pathname,assigned=false;
      while(Date.now()<deadline){
        throwIfAborted();const manual=textStates.get(requestId)?.manual;if(manual)return {ok:true,nativeReceipt:newReceipts().some(el=>el.textContent.includes('[MOOZ_REQUEST:'+request.requestCode+']')),text:manual};const next=location.origin+location.pathname;
        if(next!==conversation){if(!assigned&&initialConversation===location.origin+'/'&&newReceipts().length){conversation=next;assigned=true;}else throw Error('Cuộc trò chuyện Muse đã thay đổi. Không lấy văn bản từ chat khác.');}
        const receipt=newReceipts().at(-1),users=[...document.querySelectorAll(userSelector)];
        const candidates=assistantMessageElements().filter(el=>contextualReply(el,true)&&!el.closest(attachmentSelector)&&(!receipt||!users.some(user=>user!==receipt&&!user.contains(receipt)&&(receipt.compareDocumentPosition(user)&Node.DOCUMENT_POSITION_FOLLOWING)&&(user.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))));
        const replies=candidates.filter(el=>!candidates.some(parent=>parent!==el&&parent.contains(el)));
        const text=replies.map(el=>activity?activity.text(el):el.innerText||el.textContent||'').map(t=>t.trim()).filter(Boolean).join('\n\n');
        const streaming=[...document.querySelectorAll('[data-testid="hatch-composer-stop-button"],button[aria-label*="Stop" i],button[aria-label*="停止"],button[aria-label*="Dừng" i]')].some(readable)||replies.some(el=>el.matches('[aria-busy="true"],[data-is-streaming="true"]')||el.querySelector('[aria-busy="true"],[data-is-streaming="true"]'));
        lastScan={kind:'text',receipts:newReceipts().length,matching:replies.length,streaming};
        if(text!==last){last=text;stableSince=Date.now();}
        if(text&&!streaming&&Date.now()-stableSince>=3500){report(requestId,'Đã nhận văn bản Muse. Đang chuyển về Workflow…');return {ok:true,text};}
        await waitForAttachmentChange(Math.min(250,deadline-Date.now()),signal);
      }
      throw Error('Chưa nhận đủ văn bản từ Muse. Kiểm tra đúng cuộc trò chuyện; không tự gửi lại prompt.');
    }
    let lastProgress=Date.now(),firstWrongRatioAt=0,wrongMediaSince=0,lastCandidate='',candidateSince=0;
    let refusalContext='',refusalContextSince=0;const openedPlayers=new Set(),imageCopies=new Map();
    while(Date.now()<deadline){
      throwIfAborted();
      const scanned=attachments(contextualReply);lastScan={kind:mediaType,candidates:scanned.length,baselineExcluded:scanned.filter(a=>baseline.has(a.src)).length,receipts:newReceipts().length};
      const conversationChanged=initialConversation!==location.origin+location.pathname;lastScan.conversationChanged=conversationChanged;
      assertCurrentConversation();assertCurrentTurn();
      const fresh=scanned.filter(a=>!baseline.has(a.src)&&contextualReply(a.media,!!a.bubble));
      if(mediaType==='video')for(const item of fresh.filter(a=>a.isVideo&&!a.videoUrl&&!openedPlayers.has(a.src))){const play=[...item.el.querySelectorAll('button[aria-label],button[title],[role="button"][aria-label]')].find(button=>readable(button)&&/^(?:play|phát|播放)(?:\b|\s|$)/i.test(button.getAttribute('aria-label')||button.title||''));if(play){openedPlayers.add(item.src);play.click();report(requestId,'Muse: đã mở trình phát của kết quả mới, đang đọc đường dẫn video…');}}
      const matching=fresh.filter(a=>mediaType==='video'?a.isVideo:!a.isVideo);Object.assign(lastScan,{fresh:fresh.length,matching:matching.length});
      if(activity&&mediaType==='image')for(const item of matching){if(item.width&&item.height)continue;try{if(!imageCopies.has(item.src))imageCopies.set(item.src,activity.image(item.src,signal));const data=await imageCopies.get(item.src);item.width=data.width;item.height=data.height;}catch(error){if(signal?.aborted)throw error;lastScan.imageProbeError=error.name;imageCopies.delete(item.src);}}
      lastScan.decodedImages=matching.filter(item=>item.width>0&&item.height>0).length;
      if(Date.now()-lastProgress>=5000){lastProgress=Date.now();report(requestId,matching.length?`Muse: đã thấy ${mediaType==='video'?'video':'ảnh'} mới, đang chờ dữ liệu sẵn sàng…`:`Muse: đã gửi một lần; đang đối chiếu ${mediaType==='video'?'video':'ảnh'} với tin nhắn vừa gửi. Không gửi lại prompt.`);}
      const wrongMedia=fresh.find(a=>mediaType==='image'?a.isVideo:!a.isVideo);
      if(wrongMedia&&mediaType!=='video'&&!matching.some(a=>a.width>=128&&a.height>=128)){if(!wrongMediaSince)wrongMediaSince=Date.now();if(Date.now()-wrongMediaSince>=6000){const error=new Error('Bước này cần ảnh tĩnh nhưng Muse trả về video. Video được giữ trên tab Muse; app không dùng ảnh bìa video làm kết quả ảnh. Chuyển Muse sang Tạo ảnh và kiểm tra kết quả cũ trước khi chạy lại.');error.code='MEDIA_TYPE_MISMATCH';throw error;}}
      else wrongMediaSince=0;
      const [ratioW,ratioH]=String(size||'1:1').split(':').map(Number),expectedRatio=ratioW>0&&ratioH>0?ratioW/ratioH:1;
      const measured=matching.filter(a=>a.width>0&&a.height>0&&(mediaType!=='image'||a.width>=128&&a.height>=128)).sort((a,b)=>{
        const scoreA=Math.abs(Math.log((a.width/a.height)/expectedRatio)),scoreB=Math.abs(Math.log((b.width/b.height)/expectedRatio));
        if(Math.abs(scoreA-scoreB)>.015)return scoreA-scoreB;
        return a.el.compareDocumentPosition(b.el)&Node.DOCUMENT_POSITION_FOLLOWING?1:-1;
      });
      const best=measured[0],bestRatioError=best?Math.abs(Math.log((best.width/best.height)/expectedRatio)):Infinity;
      if(best&&bestRatioError<=.09)firstWrongRatioAt=0;
      else if(best&&!firstWrongRatioAt)firstWrongRatioAt=Date.now();
      const result=(best&&(bestRatioError<=.09||Date.now()-firstWrongRatioAt>=3500)?best:null)||(mediaType==='video'?matching.find(item=>item.videoUrl&&(!item.width||!item.height)):null);
      if(result){
        const responding=[...document.querySelectorAll('[data-testid="hatch-composer-stop-button"],button[aria-label*="Stop" i],button[aria-label*="停止"]')].some(readable);
        lastScan.responding=responding;
        if(lastCandidate!==result.src){lastCandidate=result.src;candidateSince=Date.now();}
        if(responding||Date.now()-candidateSince<1500){await waitForAttachmentChange(Math.min(500,deadline-Date.now()),signal);continue;}
        report(requestId,'Đã tìm thấy kết quả Muse. Đang chuyển về Workflow…');
        const media=mediaType==='video'?(result.el.matches('video')?result.el:result.el.querySelector('video')):(result.el.matches('img')?result.el:result.el.querySelector('img'));
        const src=mediaType==='video'?(result.videoUrl||media?.currentSrc||media?.src||''):(media?.currentSrc||media?.src||'');
        // Muse may first render a poster and attach the playable/download URL after
        // hydration. Keep waiting for that URL instead of rejecting a completed clip.
        if(!src){firstWrongRatioAt=firstWrongRatioAt||Date.now();await waitForAttachmentChange(Math.min(500,deadline-Date.now()),signal);continue;}
        const candidates=[...new Map(matching.map(item=>{const media=mediaType==='video'?(item.el.matches('video')?item.el:item.el.querySelector('video')):(item.el.matches('img')?item.el:item.el.querySelector('img'));const source=mediaType==='video'?(item.videoUrl||media?.currentSrc||media?.src||''):(media?.currentSrc||media?.src||'');return[source,{...item,source}];})).values()].filter(item=>item.source);
        const collect=async()=>{
          assertCurrentConversation();assertCurrentTurn();
          const settled=await Promise.allSettled(candidates.map(async(item)=>{
            const response=await fetch(item.source,{credentials:'include'});if(!response.ok)throw Error('Chưa tải được file.');
            const blob=await response.blob();if(!blob.size||blob.size>100*1024*1024||!blob.type.startsWith(mediaType+'/'))throw Error('Sai loại hoặc dung lượng file.');
            if(referenceFingerprints.has(await imageFingerprint(blob)))return null;
            return {url:await blobToDataUrl(blob)};
          }));
          const items=[];let expected=0;
          for(let i=0;i<settled.length;i++){const item=settled[i];if(item.status==='fulfilled'&&item.value===null)continue;expected++;if(item.status==='fulfilled'&&item.value)items.push({id:mediaType+'-'+i,...item.value});}
          if(!items.length)throw Error('Chưa thu được file thật.');
          const partial=items.length<expected;
          return {ok:true,items,expectedItems:expected,partial,url:items[0].url,nativeReceipt:newReceipts().some(el=>el.textContent.includes('[MOOZ_REQUEST:'+request.requestCode+']')),...(partial?{retryItems:collect}:{})};
        };
        try{return await collect();}catch(error){throwIfAborted();report(requestId,error.message);await waitForAttachmentChange(1000,signal);continue;}

      }
      const stop=Boolean(document.querySelector('[data-testid="hatch-composer-stop-button"],button[aria-label*="Stop" i],button[aria-label*="停止"]'));
      const currentContext=readNewAssistantContext(priorBubbleTexts),refusal=isRefusalContext(currentContext);
      if(refusal){
        if(currentContext!==refusalContext){refusalContext=currentContext;refusalContextSince=Date.now();}
        if(Date.now()-refusalContextSince>=1200){
          if(stop)clickMuseStop();
          const error=new Error(`Muse could not generate this scene: ${currentContext.slice(-700)}`);error.code='SCENE_REFUSED';throw error;
        }
      }
      else{refusalContext='';refusalContextSince=0;}
      if(!stop&&/out of credits|insufficient credits|额度不足|积分不足/i.test(currentContext))throw new Error('Tài khoản Muse không đủ lượt tạo ảnh/video.');
      await waitForAttachmentChange(Math.min(500,deadline-Date.now()),signal);
    }
    throwIfAborted();
    throw new Error(document.hidden?'Tab Muse đang ở nền và chưa đưa tệp kết quả mới vào giao diện trong thời gian chờ. Mở tab kiểm tra kết quả của lượt vừa gửi; app không tự gửi lại prompt.':`Chưa nhận được tệp ${mediaType==='image'?'ảnh':'video'} mới từ Muse trong thời gian chờ. Prompt chỉ được gửi một lần; kiểm tra tab trước khi chạy lại.`);
  }

  async function attachReferences(references,signal,allowVideo=false,request){
    const rawFiles=await Promise.all(references.map(async(reference,index)=>{
      const url=typeof reference==='string'?reference:reference?.url;
      if(!url)throw new Error(`Reference image ${index+1} has no URL.`);
      const response=await fetch(url,{credentials:'include',signal});
      if(!response.ok)throw new Error(`Could not load reference image ${index+1} (${response.status}).`);
      let blob=await response.blob();
      if(blob.type.startsWith('video/')&&allowVideo){if(!['video/mp4','video/webm','video/quicktime'].includes(blob.type)||!blob.size||blob.size>100*1024*1024)throw Error('Video Muse cần MP4/WebM/MOV, tối đa 100 MB.');}else blob=await WorkflowComposer.prepareImage(blob,signal);
      if(!(blob.type.startsWith('image/')||allowVideo&&blob.type.startsWith('video/'))||!blob.size)throw new Error(`Reference ${index+1} is not a readable image.`);
      const extension=(blob.type==='video/quicktime'?'mov':blob.type.split('/')[1]||'png').replace('jpeg','jpg').replace(/[^a-z0-9]/gi,'')||'png';
      return new File([blob],`museflow-reference-${String(index+1).padStart(2,'0')}.${extension}`,{type:blob.type});
    }));
    const fingerprints=new Set(),files=[];
    for(const file of rawFiles){const hash=await imageFingerprint(file);if(!fingerprints.has(hash)){fingerprints.add(hash);files.push(file);}}
    const composer=findComposer();
    const composerRoot=composerScope(composer);
    const acceptsImage=input=>{
      const accept=(input.accept||'').toLowerCase();
      return files.every(file=>!accept||accept.includes('*/*')||accept.includes(file.type)||accept.includes(file.type.split('/')[0]+'/*')||accept.split(',').some(ext=>ext.trim().startsWith('.')&&file.name.endsWith(ext.trim())));
    };
    const findInput=()=>{
      const all=[...document.querySelectorAll('input[type="file"]')].filter(input=>!input.disabled&&acceptsImage(input));
      const isImageInput=input=>/image|\.png|\.jpe?g|\.webp|\.gif|\.avif/i.test(input.accept||'');
      return all.find(input=>composerRoot?.contains(input)&&isImageInput(input))||
        all.find(input=>composerRoot?.contains(input))||
        all.find(isImageInput)||null;
    };
    let input=findInput();
    if(!input){
      const roots=[composerRoot,composer.closest('form'),composer.parentElement].filter(Boolean);
      const uploadButton=roots.flatMap(root=>[...root.querySelectorAll('button,[role="button"],label')]).filter(readable).find(el=>/attach|upload|image|photo|file|đính kèm|tải lên/i.test(`${el.getAttribute('aria-label')||''} ${el.getAttribute('title')||''} ${el.innerText||''}`));
      if(uploadButton){uploadButton.click();await delay(250,signal);input=findInput();}
    }
    if(!input)throw new Error('Muse không có ô tải tệp phù hợp với ảnh/video này. Prompt chưa được gửi.');
    const uploadScope=()=>composerRoot?.isConnected&&composerRoot.contains(findComposer())?composerRoot:composerScope(findComposer());
    const previewSelector='img,video,[data-file-name],[role="img"],[data-testid*="attachment" i],[data-testid*="upload" i],[class*="attachment" i],[class*="upload" i]';
    const previewElements=()=>[...uploadScope().querySelectorAll(previewSelector)].filter(el=>readable(el)&&!el.matches('input,button')&&!el.closest('[data-message-author-role]'));
    const previewKey=el=>{
      const src=el.matches('img,video')?(el.currentSrc||el.src||''):/url\(["']?(blob:|data:image\/|https?:)[^)]*\)/i.exec(getComputedStyle(el).backgroundImage)?.[0]||'';
      return `${src}|${el.getAttribute('data-file-name')||''}|${el.getAttribute('data-testid')||''}|${el.getAttribute('class')||''}|${el.getAttribute('aria-label')||''}|${el.getAttribute('title')||''}|${el.childElementCount?'':el.textContent||''}`;
    };
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'files')?.set;
    if(!setter)throw new Error('Browser does not allow setting the Muse attachment input.');
    const uploadBatch=async(batch)=>{
      const previousPreviews=new Set(previewElements().map(previewKey));
      const transfer=new DataTransfer();batch.forEach(file=>transfer.items.add(file));
      if(batch.length>1)input.multiple=true;
      setter.call(input,transfer.files);
      input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
      const started=Date.now(),deadline=started+90000;

      const previewSeen=()=>{const media=new Set(),names=new Set();for(const el of previewElements()){
        const key=previewKey(el),src=el.matches('img,video')?(el.currentSrc||el.src||''):key.split('|',1)[0];
        const name=[el.getAttribute('data-file-name'),el.getAttribute('aria-label'),el.getAttribute('title'),el.childElementCount?'':el.textContent].filter(Boolean).join(' ');
        if(previousPreviews.has(key))continue;if(src)media.add(src);for(const file of batch)if(name.includes(file.name))names.add(file.name);
      }return media.size>=batch.length||names.size>=batch.length;};
      while(Date.now()<deadline){WorkflowComposer.assertService(request);WorkflowComposer.assertUpload(uploadScope());if(signal?.aborted)throw new DOMException('Generation stopped by user.','AbortError');if(previewSeen()&&!uploadScope().querySelector('[role="progressbar"],[aria-busy="true"]')&&Date.now()-started>1500)return;await delay(160,signal);}
      const error=Error(`Chưa xác nhận được ${batch.length} tệp tham chiếu trong ô chat Muse sau 90 giây. Prompt chưa được gửi. Mở đúng tab đã chọn, kiểm tra ảnh đính kèm và thông báo tải tệp; tải lại tab cùng MooZ Connect nếu cần. Kết quả cũ trong node chưa được thay thế.`);error.code='MUSE_UPLOAD_UNCONFIRMED';throw error;
    };
    if(files.length>1&&!input.multiple){
      for(const file of files)await uploadBatch([file]);
    }else await uploadBatch(files);
    return fingerprints;
  }

  async function imageFingerprint(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('Media conversion failed.'));reader.readAsDataURL(blob);});}
})();
