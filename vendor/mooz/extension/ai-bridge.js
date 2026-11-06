/* Isolated-world bridge: only extension messages, no page-supplied commands. */
(() => {
  if(globalThis.__workflowAIBridge==='1.9.3')return;if(globalThis.__workflowAIBridge)return;globalThis.__workflowAIBridge='1.9.3';
  const isGPT=/(^|\.)chatgpt\.com$/.test(location.hostname)||location.hostname==='chat.openai.com';
  const isGrok=/^(?:www\.)?grok\.com$/.test(location.hostname),isFlow=location.hostname==='flow.google.com'||location.hostname==='labs.google'&&/^\/fx\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tools\/flow(?:\/|$)/.test(location.pathname);
  const provider=isGPT?'chatgpt':isGrok?'grok':isFlow?'flow':'gemini';
  const completed=new Map();
  const active=new Map(),earlySend=new Set(),manualResults=new Map();let busy=false,lastScan=null,currentRequest=null;
  const visible=el=>el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const activity=globalThis.WorkflowAIActivity,readable=el=>activity?activity.readable(el):visible(el);
  function composer(){
    const selectors=isGPT
      ? '#prompt-textarea,textarea[data-id="root"],#composer-background [contenteditable="true"],form [contenteditable="true"],[contenteditable="true"][role="textbox"],main [contenteditable="true"],textarea[placeholder],textarea[aria-label]'
      : 'rich-textarea [contenteditable="true"],[contenteditable="true"][role="textbox"],[contenteditable="true"][data-lexical-editor],[contenteditable="true"][data-placeholder],textarea';
    const score=el=>(!isGPT&&el.closest('rich-textarea')?40:0)+(el.id==='prompt-textarea'||isFlow&&el.id==='PINHOLE_TEXT_AREA_ELEMENT_ID'?100:0)+(el.closest('#composer-background,[data-testid="composer"],form')?30:0)+(el.getAttribute('role')==='textbox'||isFlow&&el.hasAttribute('data-lexical-editor')?10:0)+(/hỏi chatgpt|ask chatgpt|ask anything|ask grok|message|gửi|nhắn|prompt|describe|imagine|what.*create|mô tả|tạo/i.test([el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.getAttribute('data-placeholder')].join(' '))?20:0);
    const candidates=[...document.querySelectorAll(selectors)].filter(el=>
      (el instanceof HTMLTextAreaElement||el.isContentEditable)&&(visible(el)||activity&&readable(el))&&!el.matches(':disabled')&&!el.readOnly&&el.getAttribute('aria-disabled')!=='true'&&el.getAttribute('aria-readonly')!=='true'&&!el.closest('article,[data-message-author-role],[data-turn],[data-testid*="writing-block"],[data-type="writing-block"],.writing-block,[data-testid="canvas-editor"],[data-testid="canvas"],model-response,user-query,pre,code,[role="dialog"],[role="search"],nav,header')&&score(el)>0
    );
    return candidates.sort((a,b)=>score(b)-score(a))[0]||null;
  }
  const historySelector='model-response,user-query,[data-message-author-role],[data-role="assistant"],[data-role="user"],.response-content-markdown,[data-testid^="conversation-turn-"]';
  // Never use <main>: Gemini keeps the conversation and composer under it.
  function root(el){
    if(!el)throw new Error('Không tìm thấy ô nhập AI. Mở trang chat rồi thử lại.');
    const known=el.closest('form,input-area-v2,input-area,[data-testid="composer"],#composer-background');
    if(known&&!known.querySelector(historySelector))return known;
    let best=el.parentElement;
    for(let node=el.parentElement;node&&node!==document.body&&node.tagName!=='MAIN';node=node.parentElement){
      if(node.querySelector(historySelector))break;
      best=node;
      if(node.matches('form,input-area-v2,input-area,[data-testid="composer"],#composer-background'))return node;
      if([...node.querySelectorAll('button,[role="button"]')].some(b=>/send|gửi|submit|hatch-composer/i.test(`${b.getAttribute('aria-label')||''} ${b.getAttribute('data-testid')||''} ${b.textContent||''}`)))return node;
    }
    return best;
  }
  const buttons=(scope=document)=>[...scope.querySelectorAll('button,[role="button"]')].filter(readable);
  const label=el=>`${el.getAttribute('aria-label')||''} ${el.getAttribute('data-testid')||''} ${el.getAttribute('title')||''} ${el.textContent||''}`;
  const stopped=()=>[...document.querySelectorAll('button,[role="button"]')].filter(readable).find(el=>!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&((isFlow||isGrok)&&/^\s*(?:stop|dừng|stop_circle)\s*$/i.test(label(el))||/stop generating|stop streaming|stop response|dừng phát trực tuyến|dừng phản hồi|dừng trả lời|dừng tạo|stop-button/i.test(label(el))||el.matches('.stop-button,[data-testid="stop-button"]')));
  const generating=()=>!!((isFlow||isGrok)&&[...document.querySelectorAll('main [role="progressbar"],[data-state="generating"],[data-testid="generation-card"][aria-busy="true"]')].some(readable));
  const send=()=>WorkflowComposer.findSend(root(composer()));
  const writingSelector='[data-testid="writing-block"],[data-testid^="writing-block-"],[data-type="writing-block"],.writing-block';
  function replies(){
    if(isFlow||isGrok&&currentRequest?.mediaType!=='text'){const media=[...document.querySelectorAll(currentRequest?.mediaType==='image'?'img':'video')].filter(el=>readable(el)&&!el.closest('form,[role="dialog"],nav,header,[data-role="user"],[data-message-author-role="user"],[data-turn="user"]')&&!root(composer())?.contains(el));return [...new Set(media.map(el=>el.closest('[data-testid="generation-card"],[data-testid="asset-card"],[data-generation-id],[data-item-id],article')||el))];}
    const selector=isGrok?'[data-role="assistant"],[data-message-author-role="assistant"],.response-content-markdown,[data-testid="assistant-message"]':isGPT?'[data-message-author-role="assistant"],[data-turn="assistant"],'+writingSelector:'model-response,.model-response,[data-message-author-role="model"],[data-message-author-role="assistant"],.model-response-text,.markdown-main-panel,message-content';
    const nodes=[...document.querySelectorAll(selector)];
    if(isGPT)for(const turn of document.querySelectorAll('article[data-testid^="conversation-turn-"],[data-testid^="conversation-turn-"]')){if(!turn.matches('[data-turn="user"]')&&!turn.querySelector('[data-message-author-role="user"],[data-turn="user"]')&&turn.querySelector('[data-testid="copy-turn-action-button"],'+writingSelector+',.markdown.prose,img[src]'))nodes.push(turn);}
    if(isGPT)for(const copy of document.querySelectorAll('[data-testid="copy-turn-action-button"]')){const turn=copy.closest('article,[data-testid^="conversation-turn-"]');if(turn&&!turn.querySelector('[data-message-author-role="user"],[data-turn="user"]'))nodes.push(turn);}
    const candidates=[...new Set(nodes)].filter(el=>!el.closest('user-query,[data-message-author-role="user"],[data-turn="user"],[data-role="user"]')&&(!composer()||!el.contains(composer())));
    const rendered=candidates.filter(el=>readable(el)||[...el.querySelectorAll('p,div,img,pre')].some(readable));
    return rendered.filter(el=>!rendered.some(parent=>parent!==el&&parent.contains(el)));
  }
  function replyText(el){
    const writing=el.matches(writingSelector)?el:el.querySelector(writingSelector);
    const select='message-content,.markdown-main-panel,.markdown';
    const chunks=writing?[writing.querySelector('[data-testid="writing-block-content"],[data-writing-block-content],.ProseMirror,[contenteditable="true"],.markdown')||writing]:[...el.querySelectorAll(select)].filter(node=>!node.closest('thinking-panel,.thoughts-container,.thoughts-content,[data-testid="thinking-content"]'));
    if(!chunks.length)chunks.push(el);
    return chunks.filter(node=>!chunks.some(parent=>parent!==node&&parent.contains(node))).map(content=>{
      if(activity)return activity.text(content);
      if(writing&&content===writing){const copy=content.cloneNode(true);copy.querySelectorAll('button,header,[role="toolbar"]').forEach(node=>node.remove());return String(copy.textContent||'').trim();}
      return String(content.innerText||content.textContent||'').trim();
    }).filter(Boolean).join('\n\n');
  }
  function report(request,text){if(chrome.runtime.sendMessage)void chrome.runtime.sendMessage({type:'WORKFLOW_AI_PROGRESS',requestId:request.requestId,text}).catch(()=>{});}

  const uploadedNames=new Set();
  function attachments(scope){
    const selectors='[data-testid*="attachment"],[data-testid*="file-thumbnail"],[data-file-name],.file-preview,.file-preview-container,.file-preview-chip,.attachment-preview,.image-preview-container,.attachment-container,.uploaded-file,.file-chip,.image-preview';
    const candidates=new Set(scope.querySelectorAll(selectors));
    // ChatGPT may render a generic document/video card with no attachment classes.
    // Match only file labels inside the composer, never FileList selection or history.
    for(const el of scope.querySelectorAll('div,span,a,button')){
      if(el.contains(composer())||el.isContentEditable||el.closest('[contenteditable="true"]'))continue;
      const text=[el.getAttribute('title'),el.getAttribute('aria-label'),el.getAttribute('data-file-name'),el.childElementCount? '':el.textContent].filter(Boolean).join(' ');
      if([...uploadedNames].some(name=>text.includes(name)||text.includes(name.slice(0,17)))||/workflow-[a-f0-9-]{8,}|\S+\.(?:mp4|webm|mov|m4v|png|jpe?g|pdf)(?:$|\s)/i.test(text))candidates.add(el);
    }
    return [...candidates].filter(el=>visible(el)&&!el.closest(historySelector)&&(String(el.innerText||el.textContent||'').trim()||el.querySelector('img[src],video[src],[data-file-name],[role="progressbar"]')||buttons(el).some(b=>/remove|xóa|xoá/i.test(label(b)))));
  }
  const uploading=()=>root(composer()).querySelector('[role="progressbar"],[aria-busy="true"],[data-state="uploading"],[data-status="uploading"],.animate-spin');
  async function wait(check,ms,signal,message){const end=Date.now()+ms;while(Date.now()<end){WorkflowComposer.assertService(currentRequest);if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');const result=await check();if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');if(result)return result;if(activity)await activity.wait(180,signal);else await new Promise(resolve=>setTimeout(resolve,180));}throw new Error(message);}
  async function imageFingerprint(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const mediaNodes=(el,tag)=>[...(el.matches?.(tag)?[el]:[]),...el.querySelectorAll(tag)];
  const videoSources=el=>mediaNodes(el,'video').map(v=>v.currentSrc||v.src||v.querySelector('source')?.src).filter(Boolean);
  const imageSources=el=>mediaNodes(el,'img').map(img=>img.currentSrc||img.src).filter(Boolean);
  function setText(el,text){
    el.focus();
    if(el instanceof HTMLTextAreaElement){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,text);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));}
    else{
      // Native editing lets Quill/ProseMirror update their document model.
      const selection=getSelection(),range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertText',false,text))throw new Error('Không nhập được prompt vào trình soạn thảo AI. Prompt chưa được gửi.');
    }
  }
  async function clearDraft(signal){
    const el=await wait(composer,5000,signal,'Ô nhập AI đang tải hoặc chưa được nhận diện. Tải lại tab AI rồi thử lại.');
    if(stopped()||generating())throw new Error('AI đang trả lời. Hãy đợi hoặc dừng câu trả lời hiện tại.');
    setText(el,'');
    const scope=root(el);const remove=()=>WorkflowComposer.removeButtons(root(composer()),composer());
    for(const b of remove())b.click();
    await wait(()=>!remove().length&&!attachments(scope).length,10000,signal,'Không dọn được tệp đính kèm cũ. Hãy xóa tệp trong ô chat rồi chạy lại.');
  }
  async function attach(urls,signal,imageCount=0){
    const fingerprints=new Set();
    for(let i=0;i<urls.length;i++){
      const response=await fetch(urls[i],{signal});if(!response.ok)throw new Error('Không đọc được tệp tham chiếu.');let blob=await response.blob();
      if(i<imageCount){blob=await WorkflowComposer.prepareImage(blob,signal);fingerprints.add(await imageFingerprint(blob));}
      if(!/^(image|video)\//.test(blob.type)||!blob.size)throw new Error('Tệp tham chiếu không phải ảnh/video có thể đọc.');
      if(blob.size>100*1024*1024)throw new Error('Tệp tải qua tab vượt 100 MB.');
      const scope=root(composer());
      const accepts=input=>!input.accept||input.accept.includes('*/*')||input.accept.includes(blob.type.split('/')[0])||input.accept.includes(blob.type)||input.accept.includes('.'+blob.type.split('/')[1]);
      const input=()=>{const all=[...document.querySelectorAll('input[type="file"]')].filter(el=>!el.disabled&&accepts(el));return all.find(el=>scope.contains(el))||all[0];};
      if(!input()){
        const upload=buttons(scope).find(b=>/attach|upload|add files|thêm tệp|tải tệp|đính kèm|open.*menu/i.test(label(b)));if(upload)upload.click();
        if(activity)await activity.sleep(250,signal);else await new Promise(resolve=>setTimeout(resolve,250));
        if(!input()){const menu=buttons().find(b=>/upload files|upload from computer|tải.*máy|tải tệp/i.test(label(b)));if(menu)menu.click();}
      }
      const field=await wait(input,5000,signal,'Không tìm thấy ô tải tệp của AI. Giao diện có thể đã thay đổi.');
      const before=new Set(attachments(scope));const dt=new DataTransfer();const name=`workflow-${crypto.randomUUID()}.${blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1].replace(/[^a-z0-9]/gi,'')}`;uploadedNames.add(name);dt.items.add(new File([blob],name,{type:blob.type}));field.files=dt.files;field.dispatchEvent(new Event('change',{bubbles:true}));
      // A FileList only proves selection, not a completed remote upload.
      await wait(()=>{WorkflowComposer.assertUpload(root(composer()));return attachments(root(composer())).some(el=>!before.has(el));},120000,signal,'AI chưa xác nhận tệp đính kèm; chưa gửi prompt.');
      const appeared=Date.now();
      await wait(()=>{WorkflowComposer.assertUpload(root(composer()));return !uploading()&&Date.now()-appeared>=1500;},600000,signal,'Tệp chưa tải xong; chưa gửi prompt.');
    }
    return fingerprints;
  }
  async function generate(request,signal){
    if(isFlow&&request.mediaType==='text')throw Error('Google Flow tạo ảnh/video; chọn Grok, Gemini, ChatGPT hoặc Muse để viết văn bản.');
    if((isFlow||isGrok)&&request.referenceVideos?.length)throw Error('Bộ nối này chưa tải video tham chiếu. Chưa gửi prompt.');
    if(request.mediaType==='video'&&!isFlow&&!isGrok)throw Error('Tab này chưa hỗ trợ nhận video.');
    currentRequest=request;await WorkflowComposer.waitTurn(request,'prepare',signal,text=>report(request,text));
    if(!String(request.prompt||'').trim())throw new Error('Yêu cầu trống.');
    const deadline=Date.now()+120000,initialOrigin=location.origin;let conversation=initialOrigin+location.pathname;
    const initialPath=location.pathname.replace(/\/$/,'');
    const startsNewChat=isGrok?/^(?:|\/imagine)$/.test(initialPath):isGPT?/^(?:|\/g\/[^/]+(?:\/project)?)$/.test(initialPath):/^(?:\/u\/\d+)?\/app$/.test(initialPath);
    const assignedPrefix=isGrok?(initialPath==='/imagine'?'/imagine/post/':'/c/'):isGPT?(initialPath.replace(/\/project$/,'')+'/c/'):initialPath+'/';
    let conversationAssigned=false;
    const markerId=crypto.randomUUID().replaceAll('-',''),opening=`[[WF:${markerId}]]`,closing=`[[/WF:${markerId}]]`;
    const format=request.mediaType==='text'?`Dòng đầu chỉ ghi ${opening}; dòng cuối chỉ ghi ${closing}. Đặt toàn bộ kết quả ở giữa, không thêm lời dẫn.`:'';
    const wireText=[request.rules,format,request.prompt,...((isGrok||isFlow)&&request.mediaType!=='text'?[`Tạo ${request.mediaType==='video'?'video':'ảnh'}${request.size?' tỷ lệ '+request.size:''}${request.mediaType==='video'&&request.duration!=null?', thời lượng mong muốn '+request.duration+' giây':''}.`]:[])].filter(Boolean).join('\n\n');
    const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const markedResult=reply=>{
      if(request.mediaType!=='text')return '';
      // The composer/user echo also contains markers. Only read assistant content.
      const text=replyText(reply);
      const match=new RegExp('(?:^|\\n)[ \\t]*'+escape(opening)+'[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*'+escape(closing)+'[ \\t]*(?:\\n|$)').exec(text);
      return match?.[1]?.trim()||'';
    };

    await clearDraft(signal);
    const replySnapshot=el=>request.mediaType==='video'?replyText(el)+'\n'+videoSources(el).join('\n'):request.mediaType==='image'?replyText(el)+'\n'+imageSources(el).join('\n'):replyText(el);
    const before=new Map(replies().map(el=>[el,replySnapshot(el)]));
    const baselineImages=new Set(imageSources(document)),baselineVideos=new Set(videoSources(document));
    const users=()=>{
      const all=[...document.querySelectorAll(isGPT||isGrok?'[data-message-author-role="user"],[data-turn="user"],[data-role="user"]':'user-query,.user-query-container,[data-message-author-role="user"]')];
      return all.filter(el=>!all.some(parent=>parent!==el&&parent.contains(el)));
    };
    const priorUsers=new Map(users().map(el=>[el,el.textContent]));
    let prepared=false;
    const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
    const promptText=normalize(request.prompt);
    const matchesPrompt=el=>{const text=normalize(el.textContent);return text.includes(opening)||text.includes(promptText)||(promptText.length>160&&text.includes(promptText.slice(0,160)));};
    const echoReceipts=()=>users().filter(el=>(!priorUsers.has(el)||priorUsers.get(el)!==el.textContent)&&matchesPrompt(el));
    const echo=()=>echoReceipts().length>0;
    const freshReplies=()=>{
      const known=replies(),fresh=known.filter(el=>!before.has(el)||before.get(el)!==replySnapshot(el));
      // Provider DOM can change. A complete, request-specific marker pair is
      // still usable inside a single response block, never across the whole page.
      if(request.mediaType==='text'){
        const marked=[...document.querySelectorAll('section,article,div,p,pre,message-content')].filter(el=>
          readable(el)&&!known.some(parent=>parent.contains(el))&&!el.contains(composer())&&!el.closest('form,user-query,.user-query-container,[data-message-author-role="user"],[data-turn="user"],[data-role="user"],nav,header')&&el.textContent.includes(opening)&&el.textContent.includes(closing)&&markedResult(el));
        fresh.push(...marked.filter(el=>!marked.some(child=>child!==el&&el.contains(child))));
      }
      return fresh;
    };
    const currentReply=reply=>{
      const receipt=echoReceipts().at(-1);
      if(!receipt){
        // A missing/collapsed echo can be tolerated only when the draft cleared,
        // no different user turn appeared, and the reply is after the old tail.
        const input=composer(),draft=normalize(input?.value??input?.innerText);
        if(draft===normalize(wireText)||users().some(el=>!priorUsers.has(el)||priorUsers.get(el)!==el.textContent))return false;
        if(isFlow)return !before.has(reply);
        const tail=[...before.keys()].at(-1),anchor=tail?.isConnected?tail:replies().find(el=>replySnapshot(el)===before.get(tail));
        return !before.has(reply)&&(!tail||anchor&&!!(anchor.compareDocumentPosition(reply)&Node.DOCUMENT_POSITION_FOLLOWING));
      }
      if(receipt.contains(reply)||reply.contains(receipt)||!(receipt.compareDocumentPosition(reply)&Node.DOCUMENT_POSITION_FOLLOWING))return false;
      // Do not collect a later conversation turn after another user has sent a message.
      return !users().some(el=>el!==receipt&&!el.contains(receipt)&&(receipt.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)&&(el.compareDocumentPosition(reply)&Node.DOCUMENT_POSITION_FOLLOWING));
    };
    const checkConversation=()=>{
      const next=location.origin+location.pathname;if(next===conversation)return;
      const assigned=location.pathname.startsWith(assignedPrefix)&&/^[^/]+\/?$/.test(location.pathname.slice(assignedPrefix.length));
      // Normal first-send navigation creates an ID. Never adopt another existing chat.
      if(prepared&&startsNewChat&&!conversationAssigned&&assigned&&location.origin===initialOrigin&&(echo()||freshReplies().some(currentReply))){conversation=next;conversationAssigned=true;return;}
      throw new Error('Cuộc trò chuyện đã thay đổi. Đã dừng để tránh lấy kết quả từ chat khác.');
    };
    const submitted=()=>{
      if(!prepared)return false;
      checkConversation();
      if(echo())return true;
      const input=composer(),draft=input?normalize(input.value??input.innerText):'';
      // Composer may be hidden/replaced while ChatGPT opens a writing block.
      // A retained, different draft is not evidence that this request failed.
      const ownDraft=draft&&draft===normalize(wireText);
      return !ownDraft&&(!!stopped()||freshReplies().some(currentReply));
    };
    report(request,'Đang đưa tài liệu vào cuộc trò chuyện. Chờ tải tệp hoàn tất…');
    const referenceFingerprints=await attach([...(request.referenceImages||[]),...(request.referenceVideos||[])],signal,(request.referenceImages||[]).length);
    checkConversation();
    if(!submitted()){
      before.clear();for(const el of replies())before.set(el,replySnapshot(el));
      priorUsers.clear();for(const el of users())priorUsers.set(el,el.textContent);
      for(const src of imageSources(document))baselineImages.add(src);for(const src of videoSources(document))baselineVideos.add(src);
      const text=wireText;
      const editor=await wait(composer,5000,signal,'Ô nhập AI vừa thay đổi. Tải lại tab AI rồi thử lại.');
      setText(editor,text);prepared=true;
      if(activity)await activity.sleep(300,signal);else await new Promise(resolve=>setTimeout(resolve,300));
      const normalized=value=>String(value||'').replace(/\s+/g,' ').trim();
      if(normalized(composer()?.value??composer()?.innerText)!==normalized(text))throw new Error('AI không giữ được prompt trong ô nhập. Chưa gửi yêu cầu; hãy tải lại tab AI.');
      if(request.stageBeforeSend&&request.mediaType==='text'){
        let lastSecond=-1;
        await wait(()=>{
          checkConversation();WorkflowComposer.assertUpload(root(composer()));
          const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
          if(seconds!==lastSecond){lastSecond=seconds;report(request,`Tệp đã tải xong. Tự gửi sau ${seconds} giây; có thể bấm Gửi ngay.`);}
          return submitted()||earlySend.has(request.requestId)||seconds===0;
        },Math.max(1000,deadline-Date.now()+2000),signal,'Hết thời gian chuẩn bị gửi.');
      }
      checkConversation();WorkflowComposer.assertUpload(root(composer()));
      if(!submitted()){
        let button=await wait(()=>{checkConversation();if(submitted())return true;WorkflowComposer.assertUpload(root(composer()));return !uploading()&&send();},600000,signal,'Không tìm thấy nút Gửi sẵn sàng. Prompt chưa được gửi.');
        if(button!==true){
          let permit;
          do{
            permit=await WorkflowComposer.waitTurn(request,'permit',signal,text=>report(request,text));
            if(submitted()){button=true;break;}
            WorkflowComposer.assertService(request);checkConversation();WorkflowComposer.assertUpload(root(composer()));
            if(normalized(composer()?.value??composer()?.innerText)!==normalized(wireText))throw Error('Prompt đã thay đổi trong lúc chờ lượt. Chưa gửi AI; kiểm tra lại ô soạn thảo.');
            button=send();if(!button||uploading())throw Error('Ô chat chưa sẵn sàng sau khi chờ lượt. Chưa gửi AI.');
            for(const src of imageSources(document))baselineImages.add(src);for(const src of videoSources(document))baselineVideos.add(src);
          }while(permit.expiresAt<=Date.now());
          if(button!==true){button.click();await WorkflowComposer.sent(request);report(request,'Đã bấm Gửi. Đang xác nhận AI nhận yêu cầu…');}
        }
      }
    }
    report(request,'Đang xác nhận AI nhận yêu cầu; không gửi lại prompt…');
    await wait(submitted,90000,signal,'Chưa xác nhận AI nhận prompt sau 90 giây. Kiểm tra tab AI; không tự gửi lại để tránh trùng lặp.');
    report(request,'AI đã nhận yêu cầu. Đang chờ phản hồi…');
    let last='',since=Date.now(),reportedReply=false,lastImage='',imageSince=0;
    const imageCopies=new Map();
    let imageError='',nextImageRead=0,imageFailures=0;
    const copyImage=src=>{
      if(!imageCopies.has(src))imageCopies.set(src,(async()=>{let blob;if(activity){const result=await activity.image(src,signal);if(result.width<256||result.height<256){baselineImages.add(src);return null;}blob=result.blob;}else{const r=await fetch(src,{signal});if(!r.ok)throw new Error('Không tải được ảnh kết quả từ tab AI.');blob=await r.blob();}if(!blob.size||!blob.type.startsWith('image/'))throw new Error('Kết quả AI chưa phải tệp ảnh hợp lệ.');if(referenceFingerprints.has(await imageFingerprint(blob))){baselineImages.add(src);report(request,'Bỏ qua ảnh tham chiếu hiển thị lại. Đang chờ ảnh AI tạo trong lượt này…');return null;}return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});})());
      return imageCopies.get(src).catch(error=>{imageCopies.delete(src);throw error;});
    };
    const result=await wait(async()=>{
      checkConversation();
      const fresh=freshReplies().filter(currentReply);const reply=fresh.at(-1);
      lastScan={provider,kind:request.mediaType,replies:replies().length,current:fresh.length,images:reply?.querySelectorAll('img').length||0};
      if(!reply)return false;
      if(isFlow&&fresh.length>1)throw Error('Có nhiều kết quả mới trong Flow; chưa tự chọn để tránh lấy nhầm. Kiểm tra tab và dùng Khôi phục thủ công.');
      const text=replyText(reply);if(!reportedReply&&text){reportedReply=true;report(request,'Đã thấy phản hồi. Đang đợi AI hoàn tất…');}if(text!==last){last=text;since=Date.now();}
      if(stopped()||generating()||reply.matches('[aria-busy="true"],[data-is-streaming="true"]')||reply.querySelector('[aria-busy="true"],[data-is-streaming="true"]')||Date.now()-since<3500)return false;
      if(request.mediaType==='text'){if(text.includes(opening)&&!text.includes(closing))return false;const clean=markedResult(reply)||text.replaceAll(opening,'').replaceAll(closing,'').trim();return clean?{ok:true,text:clean}:false;}
      if(request.mediaType==='video'){
        const videos=mediaNodes(reply,'video').filter(v=>readable(v)&&!baselineVideos.has(v.currentSrc||v.src||v.querySelector('source')?.src)&&!v.closest('[data-role="user"],[data-message-author-role="user"],[data-turn="user"],[class*="avatar" i]'));
        const video=videos.at(-1),src=video&&(video.currentSrc||video.src||video.querySelector('source')?.src);if(!src)return false;
        if(lastImage!==src){lastImage=src;imageSince=Date.now();}if(Date.now()-imageSince<1500||Date.now()<nextImageRead)return false;
        try{const response=await fetch(src,{signal});if(!response.ok)throw Error('Không tải được video.');const blob=await response.blob();if(!blob.type.startsWith('video/')||!blob.size||blob.size>100*1024*1024)throw Error('Video chưa có tệp hợp lệ hoặc vượt 100 MB.');
          // Gallery previews may use preload=none. Validate the downloaded bytes,
          // without playing/changing the site's preview or treating its poster as video.
          const probe=document.createElement('video'),objectURL=URL.createObjectURL(blob);try{await new Promise((resolve,reject)=>{const finish=error=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);probe.onloadedmetadata=probe.onerror=null;error?reject(error):resolve();},cancel=()=>finish(new DOMException('Đã dừng.','AbortError')),timer=setTimeout(()=>finish(Error('Chưa đọc được thông tin video.')),10000);signal.addEventListener('abort',cancel,{once:true});probe.onloadedmetadata=()=>finish(probe.videoWidth>0&&probe.videoHeight>0&&probe.duration>0&&Number.isFinite(probe.duration)?null:Error('Video chưa có thông tin hợp lệ.'));probe.onerror=()=>finish(Error('Tệp trả về chưa giải mã được thành video.'));probe.preload='metadata';probe.src=objectURL;if(signal.aborted)cancel();});}finally{probe.removeAttribute('src');probe.load();URL.revokeObjectURL(objectURL);}
          const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});return {ok:true,url};}
        catch(error){if(signal.aborted)throw error;nextImageRead=Date.now()+8000;report(request,'Đã thấy video mới nhưng chưa đọc được tệp. Mở kết quả trong tab AI để kiểm tra quyền tải; chưa đánh dấu hoàn tất.');return false;}
      }
      const images=mediaNodes(reply,'img').filter(img=>readable(img)&&(activity||img.naturalWidth>=256&&img.naturalHeight>=256)&&!img.closest('user-query,[data-message-author-role="user"],[data-turn="user"],[data-role="user"],[data-testid*="avatar" i],[class*="avatar" i]')&&!baselineImages.has(img.currentSrc||img.src)&&Boolean(img.currentSrc||img.src));
      const image=images.at(-1);if(!image){lastImage='';return false;}
      const src=image.currentSrc||image.src,key=src+'|'+image.naturalWidth+'x'+image.naturalHeight;
      if(key!==lastImage){lastImage=key;imageSince=Date.now();nextImageRead=0;imageFailures=0;}if(Date.now()-imageSince<1500||Date.now()<nextImageRead)return false;
      try{const url=await copyImage(src);imageError='';imageFailures=0;return url?{ok:true,url}:false;}
      catch(error){if(signal.aborted)throw error;nextImageRead=Date.now()+Math.min(8000,1000*2**Math.min(imageFailures++,3));const message=String(error.message||error);if(message!==imageError){imageError=message;report(request,'Đã thấy ảnh trong lượt hiện tại, đang thử đọc tệp ảnh lại. Nếu vẫn chờ, mở ảnh trên tab AI để kiểm tra quyền tải.');}return false;}
    },600000,signal,'Hết thời gian chờ kết quả AI. Kiểm tra tab AI; không tự gửi lại prompt.');
    return {...result,chatURL:location.href};
  }
  chrome.runtime.onMessage.addListener((request,sender,respond)=>{
    if(sender.id!==chrome.runtime.id)return false;
    if(request.type==='WORKFLOW_AI_RESULT'){const item=completed.get(request.requestId);respond(item&&Date.now()-item.at<1800000?item.result:{ok:false,pending:active.has(request.requestId),error:'Chưa có kết quả đã hoàn tất cho mã lượt này.'});return false;}
    if(request.type==='WORKFLOW_AI_CHECK'){
      const capabilities=()=>({provider,types:isFlow?['image','video']:isGrok?['text','image','video']:['text','image'],sendProtocol:1,...(WorkflowComposer.serviceState()?{block:WorkflowComposer.serviceState()}:{}),bridgeVersion:chrome.runtime.getManifest?.()?.version||'0.38.2',resultProtocol:3,backgroundProtocol:activity?1:0,lastScan});
      if(busy){respond({ok:true,signedIn:true,composer:!!composer(),busy:true,...capabilities()});return false;}
      wait(composer,3500,null,'Không nhận diện được ô nhập trên trang AI đang mở.').then(()=>respond({ok:true,signedIn:true,composer:true,busy:!!stopped()||generating(),...capabilities()}),()=>respond({ok:true,signedIn:false,composer:false,...capabilities(),error:'Tab AI đã kết nối nhưng chưa nhận diện được ô nhập đang chỉnh sửa. Mở cuộc trò chuyện và tải lại tab AI.'}));return true;
    }
    if(request.type==='WORKFLOW_AI_USE_RESULT'){const resolve=manualResults.get(request.requestId);if(!resolve||typeof request.text!=='string'||!request.text.trim()){respond({ok:false});return false;}resolve({ok:true,text:request.text.trim()});respond({ok:true});return false;}
    if(request.type==='WORKFLOW_AI_SEND_NOW'){const pending=active.has(request.requestId);if(pending)earlySend.add(request.requestId);respond({ok:pending});return false;}
    if(request.type==='WORKFLOW_AI_STOP'){const controller=active.get(request.requestId);if(controller){controller.abort();stopped()?.click();}respond({ok:true,stopped:!!controller});return false;}
    if(request.type!=='WORKFLOW_AI_GENERATE')return false;
    if(busy){respond({ok:false,error:'Tab AI đang xử lý một yêu cầu khác.'});return false;}
    busy=true;const controller=new AbortController();active.set(request.requestId,controller);activity?.start(request.requestId);
    const manual=new Promise(resolve=>manualResults.set(request.requestId,resolve));
    Promise.race([generate(request,controller.signal),manual]).then(result=>{completed.set(request.requestId,{result,at:Date.now()});let bytes=0;for(const value of completed.values())bytes+=value.result.url?.length||0;while(completed.size>8||bytes>64*1024*1024){const key=completed.keys().next().value;bytes-=completed.get(key).result.url?.length||0;completed.delete(key);}respond(result);},error=>respond({ok:false,error:error.message,code:error.code,block:error.block})).finally(()=>{controller.abort();currentRequest=null;busy=false;active.delete(request.requestId);earlySend.delete(request.requestId);manualResults.delete(request.requestId);activity?.finish(request.requestId);});return true;
  });
})();
