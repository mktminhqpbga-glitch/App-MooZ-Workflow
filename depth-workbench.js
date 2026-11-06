import {el,button,notice} from './client-api.js';
import {icon} from './icons.js';
import {addAsset,write,remove} from './core/storage.js';
import {createDepthVideo,videoMetadata} from './core/depth-video.js';
export async function openDepthWorkbench(source,{onResult=()=>{},signal,projectId=source?.projectId}={}) {
 signal?.throwIfAborted();
 if(source?.kind!=='video')throw Error('Chọn video tải lên để tạo bản đồ chiều sâu.');
 const lifecycle=new AbortController();
 const dialog=el('dialog',undefined,'post-workbench depth-workbench'),header=el('header'),close=button('Đóng',()=>dialog.close()),layout=el('div',undefined,'post-workbench-layout'),form=el('form'),fields=el('div',undefined,'post-fields'),preview=el('section',undefined,'post-preview'),status=el('p','Đang đọc thông tin video…'),progress=el('progress'),resultPreview=el('div');
 dialog.setAttribute('aria-label','Tạo video chiều sâu');close.prepend(icon('close'));header.append(el('h2','Tạo video chiều sâu'),close);
 const urls=new Map(),urlFor=asset=>{if(!urls.has(asset.id))urls.set(asset.id,URL.createObjectURL(asset.blob));return urls.get(asset.id);},media=asset=>{const video=el('video');video.controls=true;video.muted=true;video.src=urlFor(asset);return video;};
 const input=(label,type,value)=>{const wrap=el('label'),control=el('input');control.type=type;control.setAttribute('aria-label',label);if(type==='checkbox')control.checked=value;else control.value=value;wrap.append(el('span',label),control);fields.append(wrap);return control;};
 const select=(label,options,value)=>{const wrap=el('label'),control=el('select');control.setAttribute('aria-label',label);for(const [id,text]of options)control.add(new Option(text,id));control.value=value;wrap.append(el('span',label),control);fields.append(wrap);return control;};
 const fps=select('Tần số phân tích',[[1,'1 khung/giây · nhẹ nhất'],[2,'2 khung/giây'],[4,'4 khung/giây'],[8,'8 khung/giây'],[12,'12 khung/giây'],[24,'24 khung/giây · chậm hơn']],4),size=select('Cạnh dài video xuất',[[256,'256 px'],[480,'480 px'],[640,'640 px']],640),start=input('Bắt đầu (giây)','number',0),end=input('Kết thúc (giây)','number',0),invert=input('Đảo gần / xa','checkbox',false),stabilize=input('Ổn định độ sáng giữa các khung','checkbox',true),audio=input('Giữ âm thanh gốc','checkbox',false),count=el('p');
 for(const control of [start,end]){control.step='any';control.min=0;control.required=true;}
 const run=el('button','Tạo bản đồ độ sâu'),cancel=button('Hủy xử lý',()=>controller?.abort()),add=button('Thêm vào Canvas',async()=>{if(result&&!dirty){await onResult(result);dialog.close();}}),download=button('Tải MP4 chiều sâu',()=>{if(result&&!dirty){const link=el('a');link.href=urlFor(result);link.download=result.name;link.click();}});
 run.type='submit';run.disabled=true;add.disabled=download.disabled=true;cancel.hidden=true;progress.hidden=true;
 fields.append(count,el('p','Model chạy trên máy, không gửi video ra dịch vụ AI. Gần sáng – xa tối; đây là độ sâu tương đối, không phải khoảng cách theo mét. Phân tích từng khung có thể dao động. Giảm FPS nếu Mac Intel xử lý chậm.'));
 form.append(fields,run,cancel);preview.append(el('h3','Video nguồn'),media(source),el('h3','Video chiều sâu'),resultPreview,status,progress,add,download);layout.append(form,preview);dialog.append(header,layout);document.body.append(dialog);
 let controller=null,result=null,resultOptions=null,dirty=false,metadata=null;const abortClose=()=>dialog.close();signal?.addEventListener('abort',abortClose,{once:true});
 const settings=()=>({fps:Number(fps.value),maxSide:Number(size.value),start:Number(start.value),end:Number(end.value),invert:invert.checked,stabilize:stabilize.checked,keepAudio:audio.checked});
 const syncCount=()=>{const frames=Math.ceil(Math.max(0,Number(end.value)-Number(start.value))*Number(fps.value));count.textContent=metadata?`${frames.toLocaleString('vi-VN')} khung phân tích · MP4 xuất 24 FPS · tối đa 1.200 khung/lượt`:'';};
 for(const control of fields.querySelectorAll('input,select'))control.addEventListener('input',()=>{syncCount();if(result){dirty=JSON.stringify(settings())!==resultOptions;add.disabled=download.disabled=dirty;status.textContent=dirty?'Thiết lập đã đổi. Tạo lại để dùng kết quả mới; tệp cũ vẫn nằm trong Kho.':'Kết quả khớp với thiết lập đã chọn.';}});
 const setBusy=busy=>{for(const control of fields.querySelectorAll('input,select'))control.disabled=busy;run.disabled=busy||!metadata;cancel.hidden=!busy;add.disabled=download.disabled=busy||!result||dirty;};
 form.onsubmit=async event=>{
  event.preventDefault();if(controller||!metadata)return;
  controller=new AbortController();const current=controller,options=settings();let created=null;result=null;dirty=false;resultPreview.replaceChildren();setBusy(true);progress.hidden=false;progress.removeAttribute('value');
  try{
   const output=await createDepthVideo(source,options,current.signal,update=>{if(!dialog.isConnected)return;status.textContent=update.message;if(update.phase==='frames'){progress.max=update.total;progress.value=update.current;}else progress.removeAttribute('value');});
   current.signal.throwIfAborted();
   created=await addAsset(new File([output.blob],source.name.replace(/\.[^.]+$/,'')+' · chiều sâu.mp4',{type:'video/mp4'}),{projectId,source:'local-depth'});
   current.signal.throwIfAborted();created.derivedFrom=source.id;created.processing={operation:'depth',model:output.model,modelSha256:'2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58',settings:options,frames:output.frames,analysisFps:output.analysisFps,outputFps:output.fps,width:output.width,height:output.height,report:output.report};await write('results',created);current.signal.throwIfAborted();
   result=created;resultOptions=JSON.stringify(options);resultPreview.append(media(result));status.textContent='Đã lưu video chiều sâu trong Kho Kết quả. '+output.report;
  }catch(error){if(created)await remove('results',created.id);if(dialog.isConnected)status.textContent=current.signal.aborted?'Đã hủy xử lý. Video gốc được giữ nguyên.':error.message;}
  finally{controller=null;if(dialog.isConnected){progress.hidden=true;setBusy(false);}}
 };
 dialog.addEventListener('close',()=>{lifecycle.abort();controller?.abort();signal?.removeEventListener('abort',abortClose);for(const url of urls.values())URL.revokeObjectURL(url);for(const video of dialog.querySelectorAll('video')){video.removeAttribute('src');video.load();}dialog.remove();},{once:true});
 dialog.showModal();
 try{metadata=await videoMetadata(source,lifecycle.signal);if(!dialog.isConnected)return;start.max=metadata.duration;end.max=metadata.duration;end.value=String(metadata.duration);syncCount();status.textContent=`Video ${metadata.duration.toFixed(2)} giây · ${metadata.width} × ${metadata.height}. Chọn thiết lập rồi tạo bản đồ độ sâu.`;setBusy(false);}catch(error){if(dialog.isConnected)status.textContent=error.message;}
}
