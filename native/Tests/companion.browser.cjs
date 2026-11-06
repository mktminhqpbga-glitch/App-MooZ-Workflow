// Separate extension integration test. No website account, API key or app WebView is used.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');

(async()=>{
  execFileSync('python3',['native/Tools/build_companion.py']);
  const source=execFileSync('unzip',['-p','native/artifacts/MooZ-Connect-Native.zip','ai-bridge.js'],{encoding:'utf8'});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page=await browser.newPage();
    await page.route('https://chatgpt.com/**',route=>route.fulfill({contentType:'text/html',body:'<main><div id="history"></div><form><textarea id="prompt-textarea"></textarea><button type="button" id="send">Send</button></form></main>'}));
    await page.goto('https://chatgpt.com/');
    await page.evaluate(()=>{
      window.chrome={runtime:{id:'fixture',getManifest:()=>({version:'2.0.0'}),sendMessage:async()=>({}),onMessage:{addListener:fn=>window.listener=fn}}};
      window.WorkflowComposer={findSend:()=>document.querySelector('#send'),assertService:()=>{},assertUpload:()=>{},removeButtons:()=>[],serviceState:()=>null,waitTurn:async()=>({ok:true,expiresAt:Date.now()+10000}),sent:async()=>{}};
      const images=['red','blue'].map(color=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,512,512);return canvas.toDataURL();});
      window.sendCount=0;window.failBlue=true;
      const fetch=window.fetch.bind(window);
      window.fetch=(url,options)=>url===images[1]&&window.failBlue?Promise.reject(Error('fixture transient download failure')):fetch(url,options);
      document.querySelector('#send').onclick=()=>{
        window.sendCount++;
        const input=document.querySelector('textarea'),text=input.value;input.value='';
        document.querySelector('#history').innerHTML='<article data-testid="conversation-turn-0"><div data-message-author-role="user"></div></article><article data-testid="conversation-turn-1"><img width="512" height="512"><img width="512" height="512"></article>';
        document.querySelector('[data-message-author-role=user]').textContent=text;
        [...document.querySelectorAll('#history img')].forEach((image,i)=>image.src=images[i]);
        history.replaceState(null,'','/c/native-fixture');
      };
    });
    await page.addScriptTag({content:source});
    const message=(type,extra={})=>page.evaluate(({type,extra})=>new Promise(resolve=>window.listener({type,requestId:'native-request',...extra},{id:'fixture'},resolve)),{type,extra});
    const request={mediaType:'image',requestCode:'MZ-fixture-unique',prompt:'[MOOZ_REQUEST:MZ-fixture-unique]\nTạo hai ảnh sản phẩm.'};
    assert.equal((await message('WORKFLOW_AI_JOB_START',request)).accepted,true);
    assert.equal((await message('WORKFLOW_AI_JOB_START',request)).accepted,true);
    let partial;
    for(let i=0;i<80;i++){
      const status=await message('WORKFLOW_AI_JOB_STATUS');
      if(status.state==='done'){partial=status.result;break;}
      await page.waitForTimeout(150);
    }
    assert.equal(partial?.ok,true,partial?.error);
    assert.equal(partial.partial,true);assert.equal(partial.expectedItems,2);assert.equal(partial.items.length,1);
    assert.equal(partial.receipt.requestCode,request.requestCode);
    assert.equal(partial.receipt.sentTurnMatchesRequestId,true);
    assert.equal(partial.chatURL,'https://chatgpt.com/c/native-fixture');
    await page.evaluate(()=>window.failBlue=false);
    const recovered=(await message('WORKFLOW_AI_JOB_STATUS')).result;
    assert.equal(recovered.items.length,2);assert.equal(recovered.partial,false);
    assert.ok(recovered.items.every(item=>item.url.startsWith('data:image/png;base64,')));
    assert.equal(await page.evaluate(()=>window.sendCount),1);
    const unrelated=await message('WORKFLOW_AI_JOB_STATUS',{requestId:'unrelated'});
    assert.equal(unrelated.state,'missing');
    assert.equal((await message('WORKFLOW_AI_JOB_ACK')).ok,true);
    assert.equal((await message('WORKFLOW_AI_JOB_STATUS')).state,'missing');
    console.log('PASS native companion fixture: async START, duplicate suppression, new-chat receipt with nonce, all images, partial download recovery, exact-ID STATUS and ACK. No live AI account.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
