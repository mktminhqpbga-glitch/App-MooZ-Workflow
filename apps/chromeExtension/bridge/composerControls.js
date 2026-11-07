/* Controls are searched only inside a verified composer, never in chat history. */
(() => {
  const visible=el=>globalThis.WorkflowAIActivity?WorkflowAIActivity.readable(el)&&!el.closest('[aria-hidden="true"]'):!!el?.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  function label(el){return [el.getAttribute('aria-label'),el.getAttribute('data-testid'),el.getAttribute('title'),el.textContent,...(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent)].filter(Boolean).join(' ');}
  // Verify actual image bytes before handing them to any site's upload control.
  async function prepareImage(blob,signal){
    if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');
    if(!blob.size||blob.size>20*1024*1024)throw new Error('Ảnh trống hoặc vượt 20 MB; chưa tải lên AI.');
    const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());
    const starts=values=>values.every((value,i)=>bytes[i]===value);
    const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
    const type=starts([137,80,78,71,13,10,26,10])?'image/png':starts([255,216,255])?'image/jpeg':/^GIF8[79]a$/.test(ascii(0,6))?'image/gif':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'image/webp':null;
    const source=new Blob([blob],{type:type||blob.type}),url=URL.createObjectURL(source),image=new Image();
    try{
      await new Promise((resolve,reject)=>{
        const done=error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=image.onerror=null;error?reject(error):resolve();};
        const abort=()=>done(new DOMException('Đã dừng.','AbortError'));
        const timer=setTimeout(()=>done(new Error('Quá thời gian đọc ảnh; chưa tải lên AI.')),20000);
        image.onload=()=>done();image.onerror=()=>done(new Error('Không giải mã được ảnh. Tệp hỏng hoặc định dạng chưa được trình duyệt hỗ trợ; hãy chọn lại ảnh PNG/JPG.'));
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}image.src=url;
      });
      if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw new Error('Ảnh không hợp lệ hoặc vượt 40 triệu điểm ảnh; hãy giảm kích thước trước khi tải.');
      // Preserve supported images byte-for-byte, including animation and transparency.
      if(type)return source;
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
      const png=await new Promise((resolve,reject)=>{try{canvas.toBlob(value=>value?resolve(value):reject(new Error('Không chuyển được ảnh sang PNG.')),'image/png');}catch(error){reject(error);}});
      if(png.size>20*1024*1024)throw new Error('Ảnh sau chuyển sang PNG vượt 20 MB; hãy giảm kích thước trước khi tải.');
      if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');return png;
    }finally{image.src='';URL.revokeObjectURL(url);}
  }
  function assertUpload(scope){
    if(!scope)return;
    const explicit='[role="alert"],[data-state="error"],[data-status="error"],[data-testid*="upload-error"],[data-testid*="attachment-error"],[aria-invalid="true"]';
    const failed=/upload failed|failed to upload|error uploading|could(?:n['’]t| not) upload|unsupported (?:file|image)|file too large|tải(?: lên)?[^.\n]{0,60}(?:thất bại|không thành công)|không thể tải|tệp[^.\n]{0,40}(?:quá lớn|không hỗ trợ)/i;
    for(const el of scope.querySelectorAll(explicit+',span,div,[title],[aria-label]')){
      if(!visible(el)||el.isContentEditable||el.closest('[contenteditable="true"]')||el.querySelector('textarea,[contenteditable="true"]'))continue;
      const text=[el.getAttribute('aria-label'),el.getAttribute('title'),el.childElementCount?'':el.textContent].filter(Boolean).join(' ').trim();
      if((el.matches('[data-state="error"],[data-status="error"],[data-testid*="upload-error"],[data-testid*="attachment-error"],[aria-invalid="true"]')&&text)||/^(?:error|upload error|lỗi tải (?:tệp|ảnh))$/i.test(text)||failed.test(text))throw new Error('AI báo lỗi tải tệp: '+(text||'Tải lên thất bại').slice(0,220)+'. Prompt chưa được gửi.');
    }
  }
  function upArrow(svg){
    const segments=[];
    for(const line of svg.querySelectorAll('line'))segments.push(['x1','y1','x2','y2'].map(attr=>Number(line.getAttribute(attr))));
    for(const poly of svg.querySelectorAll('polyline')){const points=(poly.getAttribute('points')||'').match(/-?\d*\.?\d+/g)?.map(Number)||[];for(let i=2;i+1<points.length;i+=2)segments.push([points[i-2],points[i-1],points[i],points[i+1]]);}
    for(const path of svg.querySelectorAll('path')){
      const tokens=(path.getAttribute('d')||'').match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g)||[];let command='',x=0,y=0,startX=0,startY=0;
      for(let i=0;i<tokens.length;){
        if(/^[a-z]$/i.test(tokens[i]))command=tokens[i++];
        if(!/^[mMlLhHvVzZ]$/.test(command))break;
        if(/[zZ]/.test(command)){x=startX;y=startY;command='';continue;}
        const count=/[hHvV]/.test(command)?1:2;if(i+count>tokens.length||tokens.slice(i,i+count).some(v=>/^[a-z]$/i.test(v)))break;
        const values=tokens.slice(i,i+count).map(Number);i+=count;const relative=command===command.toLowerCase();let nx=x,ny=y;
        if(/[hH]/.test(command))nx=values[0]+(relative?x:0);else if(/[vV]/.test(command))ny=values[0]+(relative?y:0);else{nx=values[0]+(relative?x:0);ny=values[1]+(relative?y:0);}
        if(/[mM]/.test(command)){startX=nx;startY=ny;command=relative?'l':'L';}else segments.push([x,y,nx,ny]);x=nx;y=ny;
      }
    }
    return segments.some(([x1,y1,x2,y2])=>{
      if(Math.abs(x1-x2)>.5||Math.abs(y1-y2)<4)return false;
      const topX=(x1+x2)/2,topY=Math.min(y1,y2),height=Math.abs(y1-y2);
      const wings=segments.flatMap(([ax,ay,bx,by])=>Math.hypot(ax-topX,ay-topY)<.8?[[bx,by]]:Math.hypot(bx-topX,by-topY)<.8?[[ax,ay]]:[]).filter(([x,y])=>y-topY>1&&y-topY<=height+1&&Math.abs(x-topX)>1);
      return wings.some(([x])=>x<topX)&&wings.some(([x])=>x>topX);
    });
  }
  function icon(el,kind){
    const markup=[...el.querySelectorAll('svg,[data-icon]')].map(svg=>[svg.getAttribute('class'),svg.getAttribute('data-icon'),svg.getAttribute('data-lucide'),svg.getAttribute('data-testid')].join(' ')).join(' ');
    if(kind==='send'&&[...el.querySelectorAll('svg use')].some(use=>/arrow[-_]?up|send/i.test(use.getAttribute('href')||use.getAttribute('xlink:href')||'')))return true;
    if(kind==='send'&&[...el.querySelectorAll('svg')].some(upArrow))return true;
    if(kind==='send'&&/arrow[-_ ]?up(?:\s|$)|send|paper[-_ ]?plane/i.test(markup))return true;
    if(kind==='remove'&&/(?:lucide-x(?:\s|$)|close|x-mark|xmark)/i.test(markup))return true;
    const paths=[...el.querySelectorAll('svg path')].map(path=>(path.getAttribute('d')||'').replace(/[\s,]+/g,'').toLowerCase());
    return kind==='send'?paths.some(d=>d==='m1219v5'||d==='m1219v-14'||d==='m5127-777'||d==='m512l125l1912'):
      paths.some(d=>d==='m186618'||d==='m66l1818'||d==='m186l618'||d==='m661212');
  }
  let preferred=null;
  function scopeFor(editor){
    if(!editor)return null;
    const history='video,[data-testid^="hatch-chat-attachment-presentation-"],[data-message-id],[class*="assistant-message" i],[class*="assistant-bubble" i],[data-message-author-role],model-response,user-query,[class*="hatch-chat-groupable-bubble"],[class*="chat-user-bubble"]';
    // A draft video/thumbnail is not a conversation message. In particular,
    // adding an upload must not shrink the verified form to the editor's wrapper.
    const form=editor.closest('form');if(form&&!form.querySelector('[data-message-id],[data-message-author-role],model-response,user-query,[class*="assistant-message" i],[class*="assistant-bubble" i],[class*="chat-user-bubble"]'))return form;
    let best=editor.parentElement;if(!best||best===document.body||best.tagName==='MAIN')return editor;
    for(let el=editor.parentElement;el&&el!==document.body&&el.tagName!=='MAIN';el=el.parentElement){if(el.querySelector(history))break;best=el;}
    return best;
  }
  function fingerprint(el){return JSON.stringify({tag:el.tagName,type:el.getAttribute('type')||'',aria:el.getAttribute('aria-label')||'',testId:el.getAttribute('data-testid')||'',svg:[...el.querySelectorAll('svg')].map(svg=>({viewBox:svg.getAttribute('viewBox')||'',shapes:[...svg.querySelectorAll('path,polyline,polygon,line,circle')].map(shape=>({tag:shape.tagName,...Object.fromEntries(['d','points','x1','y1','x2','y2','cx','cy','r'].filter(a=>shape.hasAttribute(a)).map(a=>[a,shape.getAttribute(a)]))}))}))});}
  function describe(el){const rect=el.getBoundingClientRect();return {tag:el.tagName,id:(el.id||'').slice(0,100),type:el.getAttribute('type'),role:el.getAttribute('role'),ariaLabel:(el.getAttribute('aria-label')||'').slice(0,120),title:(el.getAttribute('title')||'').slice(0,120),testId:(el.getAttribute('data-testid')||'').slice(0,120),disabled:el.matches(':disabled'),ariaDisabled:el.getAttribute('aria-disabled'),visible:visible(el),pointerEvents:getComputedStyle(el).pointerEvents,rect:{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)},icon:JSON.parse(fingerprint(el)).svg};}
  function bindTarget(scope,button){
    let selector=null;
    for(const attr of ['id','data-testid','aria-label','title']){const value=button.getAttribute(attr);if(!value||value.length>120)continue;const candidate=`${button.tagName.toLowerCase()}[${attr}=${CSS.escape(value)}]`;if(scope.querySelectorAll(candidate).length===1){selector=candidate;break;}}
    if(!selector){const parts=[];for(let el=button;el&&el!==scope;el=el.parentElement){const siblings=[...el.parentElement.children].filter(sibling=>sibling.tagName===el.tagName);parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el)+1})`);}selector=':scope > '+parts.join(' > ');}
    return {origin:location.origin,selector,fingerprint:fingerprint(button)};
  }
  function setPreferred(record){preferred=record&&record.origin===location.origin&&typeof record.selector==='string'&&typeof record.fingerprint==='string'?record:null;}

  function findSend(scope){
    if(!scope)return null;
    if(preferred){try{const matches=[...scope.querySelectorAll(preferred.selector)];const el=matches.length===1?matches[0]:null;if(el&&visible(el)&&!el.matches(':disabled')&&el.getAttribute('aria-disabled')!=='true'&&fingerprint(el)===preferred.fingerprint)return el;}catch{/* A stale selector never authorizes a different button. */}}
    const ranked=[...scope.querySelectorAll('button,[role="button"],input[type="submit"]')].filter(el=>visible(el)&&!el.matches(':disabled')&&el.getAttribute('aria-disabled')!=='true').map(el=>{
      const text=label(el);
      if(icon(el,'remove')||/remove|delete|attach|upload|stop|cancel|close|xóa|xoá|đính kèm|tải lên|dừng|hủy/i.test(text))return null;
      let score=0;
      if(((location.hostname==='flow.google.com'||location.hostname==='labs.google'&&/^\/fx\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tools\/flow(?:\/|$)/.test(location.pathname))&&/\barrow_forward\b|\bgenerate\b|\btạo\b/i.test(text))||/send|submit prompt|gửi|发送/i.test(text)||el.matches('.send-button,[data-testid="hatch-composer-send-button"]'))score=3;
      else if(icon(el,'send'))score=2;
      else if(el.matches('input[type="submit"]')||el instanceof HTMLButtonElement&&el.type==='submit'&&el.form)score=1;
      return score?{el,score}:null;
    }).filter(Boolean).sort((a,b)=>b.score-a.score);
    if(!ranked.length||ranked[1]?.score===ranked[0].score)return null;
    return ranked[0].el;
  }
  function removeButtons(scope,composer){
    if(!scope)return [];
    return [...scope.querySelectorAll('button,[role="button"]')].filter(el=>{
      if(!visible(el)||el.matches(':disabled'))return false;
      if(/remove.*(?:file|image|attachment|upload)|delete.*attachment|xóa.*(?:tệp|ảnh)|xoá.*(?:tệp|ảnh)/i.test(label(el)))return true;
      if(!icon(el,'remove')&&!/^\s*[×✕x]\s*$/i.test(el.textContent||''))return false;
      // An unlabeled X belongs to a file only when its small wrapper contains media.
      for(let node=el.parentElement,depth=0;node&&node!==scope&&depth<3;node=node.parentElement,depth++){
        if(node.contains(composer))return false;
        if(node.querySelector('img[src],video[src],[data-file-name]')||/workflow-[a-f0-9-]{8,}|\S+\.(?:mp4|webm|mov|pdf)(?:$|\s)/i.test(node.textContent||''))return true;
      }
      return false;
    });
  }
  // Detect service-owned notices, excluding conversation content and uploaded media.
  function serviceState(){
    const history='article,[data-message-author-role],[data-turn],model-response,.model-response,user-query,[class*="hatch-chat-groupable-bubble"],[data-testid*="message" i]';
    const shown=el=>{if(!el?.isConnected)return false;for(let n=el;n instanceof Element;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||n.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden')return false;}return true;};
    const nodes=[...document.querySelectorAll('h1,h2,[role="alert"],#challenge-running,#cf-challenge-running,.cf-browser-verification,iframe[src*="challenges.cloudflare.com"]')].filter(el=>shown(el)&&!el.closest(history));
    const editable=[...document.querySelectorAll('textarea,[contenteditable="true"]')].some(shown);
    if(!editable&&document.body){const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node,text='';while((node=walker.nextNode())&&text.length<12000){const p=node.parentElement;if(p&&!p.closest(history+',script,style,template,nav,header')&&shown(p))text+=' '+node.textContent;}nodes.push({textContent:text});}
    const text=nodes.map(el=>el.textContent||'').join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().replace(/\s+/g,' ');
    if(/da ngat ket noi muse|muse (?:has been |is )?disconnected|disconnected (?:from )?muse/.test(text))return {code:'AI_DISCONNECTED',message:'Muse đã ngắt kết nối và yêu cầu hỗ trợ. Đã ngừng cấp việc mới; mở Muse để làm theo hướng dẫn dịch vụ.'};
    if(/access denied|access blocked|account suspended|account disabled/.test(text))return {code:'AI_DISCONNECTED',message:'Dịch vụ AI đã giới hạn truy cập. Đã ngừng cấp việc; mở trang để kiểm tra hoặc liên hệ hỗ trợ.'};
    if(nodes.some(el=>el.tagName==='IFRAME')||/verify (?:that )?you(?: are|'re) human|verify your identity|xac minh ban la (?:con )?nguoi|xac minh danh tinh|verifying (?:that )?you are human|checking your browser|security verification|complete the captcha/.test(text))return {code:'AI_VERIFICATION',message:'Trang AI yêu cầu xác minh. Đã tạm dừng gửi; người dùng cần xử lý trực tiếp trên trang.'};
    if(/too many requests|rate limit exceeded|qua nhieu yeu cau|you(?: have|'ve) reached (?:your |the )?(?:usage |message )?limit/.test(text))return {code:'AI_RATE_LIMIT',message:'Trang AI báo giới hạn lượt sử dụng. Đã tạm dừng; kiểm tra hạn mức trước khi tiếp tục.'};
    return null;
  }
  function assertService(request){const block=serviceState();if(!block)return;const error=Object.assign(Error(block.message),{code:block.code,block});if(request?.dispatchProtocol===1)void chrome.runtime.sendMessage({type:'WORKFLOW_AI_GATE',requestId:request.requestId,token:request.dispatchToken,operation:'block',block}).catch(()=>{});throw error;}
  async function waitTurn(request,operation,signal,onWait=()=>{}){
    if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');assertService(request);if(request?.dispatchProtocol!==1)return {ok:true,expiresAt:Infinity};
    while(true){if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');assertService(request);
      const result=await chrome.runtime.sendMessage({type:'WORKFLOW_AI_GATE',requestId:request.requestId,token:request.dispatchToken,operation});
      if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');
      if(!result?.ok)throw Object.assign(Error(result?.error||'Chưa được app cấp quyền gửi AI.'),{code:result?.code||'AI_GATE_FAILED'});
      if(!result.waiting)return result;onWait(operation==='prepare'?'Đang đợi lượt thao tác AI chung của ứng dụng…':'Tệp đã sẵn sàng. Đang chờ nhịp gửi AI chung…');
      await new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(new DOMException('Đã dừng.','AbortError'));},timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},Math.max(100,Math.min(1000,result.waitMs||1000)));signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();});
    }
  }
  async function sent(request){if(request?.dispatchProtocol===1){const result=await chrome.runtime.sendMessage({type:'WORKFLOW_AI_GATE',requestId:request.requestId,token:request.dispatchToken,operation:'sent'});if(!result?.ok){const message='Đã thao tác gửi nhưng chưa xác nhận điều phối. Kiểm tra tab AI; không gửi lại.';throw Object.assign(Error(message),{code:'AI_SEND_UNCERTAIN',block:{code:'AI_DISCONNECTED',message}});}}}

  globalThis.WorkflowComposer={serviceState,assertService,waitTurn,sent,prepareImage,assertUpload,findSend,removeButtons,scopeFor,describe,bindTarget,setPreferred};
})();
