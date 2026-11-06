#!/usr/bin/env python3
"""Build the separate Chrome companion; the Swift app never executes this JavaScript."""
from pathlib import Path
import argparse, json, zipfile
ROOT=Path(__file__).resolve().parents[2]
def replace_once(text, old, new):
    if text.count(old)!=1:
        raise RuntimeError("Companion source contract changed: "+old[:90])
    return text.replace(old,new,1)
def generic(text):
    text=text.replace("'1.9.3'","'native-2.0.0'")
    hook="""    if(request.type==='WORKFLOW_AI_JOB_STATUS'){
      const cached=completed.get(request.requestId);
      if(cached?.result?.retryItems)cached.result.retryItems().then(result=>{cached.result=result;const {retryItems,...wire}=result;respond({ok:true,state:'done',result:{...wire,requestId:request.requestId}});},error=>respond({ok:true,state:'done',result:{ok:false,requestId:request.requestId,error:error.message}}));
      else if(cached){const {retryItems,...wire}=cached.result;respond({ok:true,state:'done',result:{...wire,requestId:request.requestId}});}
      else respond(active.has(request.requestId)?{ok:true,state:'running'}:{ok:false,state:'missing'});
      return !!cached?.result?.retryItems;
    }
    if(request.type==='WORKFLOW_AI_JOB_ACK'){completed.delete(request.requestId);respond({ok:true});return false;}
    if(request.type==='WORKFLOW_AI_JOB_START'){
      if(completed.has(request.requestId)||active.has(request.requestId)){respond({ok:true,accepted:true,requestId:request.requestId});return false;}
      if(busy){respond({ok:false,code:'TAB_BUSY',error:'Tab đang bận.'});return false;}
      const reply=respond;request={...request,type:'WORKFLOW_AI_GENERATE'};
      respond=result=>{if(!result?.ok)completed.set(request.requestId,{result:{...result,requestId:request.requestId},at:Date.now()});};
      reply({ok:true,accepted:true,requestId:request.requestId});
    }
"""
    text=replace_once(text,"    if(request.type==='WORKFLOW_AI_RESULT')",hook+"    if(request.type==='WORKFLOW_AI_RESULT')")
    # Existing exact-turn collector already excludes input fingerprints. Collect its whole stable gallery.
    start=text.index("      const image=images.at(-1);")
    end=text.index("\n    },600000",start)
    text=text[:start]+"""      if(!images.length){lastImage='';return false;}
      const sources=[...new Set(images.map(img=>img.currentSrc||img.src))];
      const key=sources.join('|');
      if(key!==lastImage){lastImage=key;imageSince=Date.now();}if(Date.now()-imageSince<1500)return false;
      const collect=async()=>{
        checkConversation();
        const settled=await Promise.allSettled(sources.map(src=>copyImage(src,new AbortController().signal)));
        const items=[];let expected=0;
        for(let i=0;i<settled.length;i++){const item=settled[i];if(item.status==='fulfilled'&&item.value===null)continue;expected++;if(item.status==='fulfilled'&&item.value)items.push({id:'image-'+i,url:item.value});}
        if(!items.length)throw Error('Chưa tải được tệp ảnh đúng lượt.');
        const partial=items.length<expected;
        return {ok:true,items,expectedItems:expected,partial,url:items[0].url,chatURL:location.href,receipt:{requestId:request.requestId,requestCode:request.requestCode,sentTurnMatchesRequestId:echoReceipts().some(el=>el.textContent.includes('[MOOZ_REQUEST:'+request.requestCode+']'))},...(partial?{retryItems:collect}:{})};
      };
      try{return await collect();}catch(error){if(signal.aborted)throw error;report(request,error.message);return false;}
""" +text[end:]
    text=replace_once(text,"const copyImage=src=>{","const copyImage=(src,copySignal=signal)=>{")
    a=text.index("const copyImage=(src,copySignal=signal)=>{");b=text.index("\n    const result=await wait",a)
    chunk=text[a:b].replace("activity.image(src,signal)","activity.image(src,copySignal)").replace("fetch(src,{signal})","fetch(src,{signal:copySignal})")
    text=text[:a]+chunk+text[b:]
    text=replace_once(text,"return {...result,chatURL:location.href};","return {...result,chatURL:location.href,receipt:{requestId:request.requestId,requestCode:request.requestCode,sentTurnMatchesRequestId:echoReceipts().some(el=>el.textContent.includes('[MOOZ_REQUEST:'+request.requestCode+']'))}};")
    # Preserve existing video validation and attach a one-item manifest where no gallery exists.
    text=replace_once(text,"return {ok:true,url};}","return {ok:true,url,items:[{id:'video-0',url}],expectedItems:1};}")
    return text
def muse(text):
    a=text.index("    if(message?.type==='MUSEFLOW_JOB_STATUS'){")
    b=text.index("    if(message?.type==='MUSEFLOW_JOB_ACK')",a)
    text=text[:a]+"""    if(message?.type==='MUSEFLOW_JOB_STATUS'){
      activity?.wake?.();const job=museJobs.get(message.requestId);
      const answer=()=>{const {retryItems,...wire}=job.result||{};sendResponse({ok:true,state:job.result?'done':'running',progress:job.progress||'',...(job.result?{result:wire}:{})});};
      if(!job){sendResponse({ok:false,state:'missing'});return false;}
      if(job.result?.retryItems){job.result.retryItems().then(result=>{job.result={...job.result,...result};answer();},()=>answer());return true;}
      answer();return false;
    }
""" +text[b:]
    text=text.replace("error:'Muse đang xử lý yêu cầu khác.'","code:'TAB_BUSY',error:'Muse đang xử lý yêu cầu khác.'")
    text=replace_once(text,"conversationUrl:location.href};job.finishedAt","conversationUrl:location.href,receipt:{requestId:id,requestCode:message.requestCode,sentTurnMatchesRequestId:result.nativeReceipt===true}};job.finishedAt")
    a=text.index("        if(src.startsWith('data:')&&!referenceFingerprints.size)return {ok:true,url:src};")
    b=text.index("\n      }\n      const stop=",a)
    text=text[:a]+"""        const candidates=[...new Map(matching.map(item=>{const media=mediaType==='video'?(item.el.matches('video')?item.el:item.el.querySelector('video')):(item.el.matches('img')?item.el:item.el.querySelector('img'));const source=mediaType==='video'?(item.videoUrl||media?.currentSrc||media?.src||''):(media?.currentSrc||media?.src||'');return[source,{...item,source}];})).values()].filter(item=>item.source);
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
""" +text[b:]
    # Text uses the same existing request-specific user receipt.
    text=text.replace("return {ok:true,text:","return {ok:true,nativeReceipt:newReceipts().some(el=>el.textContent.includes('[MOOZ_REQUEST:'+request.requestCode+']')),text:")
    return text
IDENTITY = """/* Native companion identity: stable install, browser-session epoch; no page code. */
(()=>{const original=WebSocket.prototype.send;WebSocket.prototype.send=function(value){
  let message;try{message=JSON.parse(value);}catch{return original.call(this,value);}
  if(message?.type!=='auth'||!this.url.startsWith('ws://127.0.0.1:'))return original.call(this,value);
  const socket=this;(async()=>{const local=await chrome.storage.local.get('moozNativeDeviceID');const session=await chrome.storage.session.get('moozNativeSessionID');
    const device=local.moozNativeDeviceID||crypto.randomUUID(),epoch=session.moozNativeSessionID||crypto.randomUUID();
    if(!local.moozNativeDeviceID)await chrome.storage.local.set({moozNativeDeviceID:device});
    if(!session.moozNativeSessionID)await chrome.storage.session.set({moozNativeSessionID:epoch});
    original.call(socket,JSON.stringify({...message,moozDeviceID:device,moozSessionID:epoch}));
  })().catch(()=>socket.close(1008,'Native identity unavailable'));
};})();
"""
def build(output):
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(ROOT/'downloads/MooZ-Connect.zip') as old,zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as new:
        for entry in old.infolist():
            if entry.is_dir():continue
            if entry.filename.startswith('/') or '..' in Path(entry.filename).parts:raise RuntimeError('Unsafe companion archive')
            data=old.read(entry.filename)
            if entry.filename=='manifest.json':
                manifest=json.loads(data);manifest['version']='2.0.0';manifest['name']='MooZ Connect Native';data=json.dumps(manifest,ensure_ascii=False,indent=2).encode()
            if entry.filename=='ai-bridge.js':data=generic((ROOT/'vendor/mooz/extension/ai-bridge.js').read_text()).encode()
            if entry.filename=='muse-bridge.js':data=muse(data.decode()).encode()
            if entry.filename=='desktop/chrome-relay-worker.js':data=IDENTITY.encode()+data
            new.writestr(entry,data)
    print(output)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'native/artifacts/MooZ-Connect-Native.zip');args=parser.parse_args();build(args.output)
