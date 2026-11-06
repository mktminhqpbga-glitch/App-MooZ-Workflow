import {loadMediaEngine} from './local-media.js';
function abortError(){return new DOMException('Đã hủy tạo video chiều sâu.','AbortError');}
function waitEvent(target,event,signal,start){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('Không đọc được khung hình video trong 20 giây.')),20000);const ok=()=>finish(),fail=()=>finish(Error('Không giải mã được video nguồn.')),abort=()=>finish(abortError());function finish(error){clearTimeout(timer);target.removeEventListener(event,ok);target.removeEventListener('error',fail);signal?.removeEventListener('abort',abort);error?reject(error):resolve();}target.addEventListener(event,ok,{once:true});target.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();else start();});}
export async function videoMetadata(asset,signal){const video=document.createElement('video'),url=URL.createObjectURL(asset.blob);video.muted=true;try{await waitEvent(video,'loadeddata',signal,()=>{video.src=url;});if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('Không xác định được thời lượng video.');return {duration:video.duration,width:video.videoWidth,height:video.videoHeight};}finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}}
export function depthPixels(depth,previousRange=null,{invert=false,stabilize=true,reset=false}={}){
 const sample=[];for(let i=0;i<depth.length;i+=16)if(Number.isFinite(depth[i]))sample.push(depth[i]);sample.sort((a,b)=>a-b);
 if(!sample.length)throw Error('Model trả bản đồ trống.');
 let low=sample[Math.floor(sample.length*.02)],high=sample[Math.min(sample.length-1,Math.floor(sample.length*.98))];
 if(stabilize&&previousRange&&!reset){low=previousRange.low*.75+low*.25;high=previousRange.high*.75+high*.25;}
 const pixels=new Uint8ClampedArray(depth.length*4),scale=high-low;
 for(let i=0;i<depth.length;i++){let gray=scale>1e-6?Math.round(Math.max(0,Math.min(1,(depth[i]-low)/scale))*255):128;if(invert)gray=255-gray;pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=gray;pixels[i*4+3]=255;}
 return {pixels,range:{low,high}};
}
export async function createDepthVideo(asset,options={},signal=new AbortController().signal,progress=()=>{}) {
 if(asset?.kind!=='video'||!asset.blob?.size)throw Error('Chọn một video có dữ liệu để tạo chiều sâu.');
 const execute=async lock=>{
  if(!lock)throw Error('Một tác vụ chiều sâu khác đang chạy. Chờ hoặc hủy tác vụ đó trước.');
  signal.throwIfAborted();const fps=Number(options.fps??4);if(![1,2,4,8,12,24].includes(fps))throw Error('Tần số phân tích không hợp lệ.');
  let ffmpeg,worker;const pending=new Map();let counter=0;const video=document.createElement('video'),url=URL.createObjectURL(asset.blob);video.muted=true;video.preload='auto';
  const stop=()=>{worker?.terminate();ffmpeg?.terminate();for(const entry of pending.values())entry.reject(abortError());pending.clear();};signal.addEventListener('abort',stop,{once:true});
  try{
   progress({phase:'load',message:'Đang đọc video nguồn…'});await waitEvent(video,'loadeddata',signal,()=>{video.src=url;});
   const start=Number(options.start??0),end=options.end==null||Number(options.end)===0?video.duration:Number(options.end);
   if(!Number.isFinite(video.duration)||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>video.duration+.02||end-start<.05)throw Error('Khoảng xử lý cần nằm trong video, dài ít nhất 0,05 giây.');
   const duration=Math.min(end,video.duration)-start,total=Math.ceil(duration*fps);
   if(total>1200)throw Error('Mỗi lượt tối đa 1.200 khung phân tích. Giảm FPS hoặc chọn một đoạn ngắn hơn.');
   const ratio=video.videoWidth/video.videoHeight,maxSide=Number(options.maxSide??640);
   if(![256,480,640].includes(maxSide))throw Error('Cỡ xuất cần 256, 480 hoặc 640 px.');
   const scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight)),width=Math.max(2,Math.round(video.videoWidth*scale/2)*2),height=Math.max(2,Math.round(video.videoHeight*scale/2)*2);
   worker=new Worker(new URL('../depth-worker.js',import.meta.url),{type:'module'});
   worker.onmessage=event=>{const entry=pending.get(event.data.id);if(!entry)return;pending.delete(event.data.id);event.data.error?entry.reject(Error(event.data.error)):entry.resolve(event.data);};worker.onerror=event=>{for(const entry of pending.values())entry.reject(Error(event.message||'Không chạy được model local.'));pending.clear();};
   const ask=(type,body={})=>new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});worker.postMessage({id,type,...body},body.rgba?[body.rgba.buffer]:[]);});
   progress({phase:'load',message:'Đang nạp model MiDaS Small trên máy…'});await ask('init');signal.throwIfAborted();
   await loadMediaEngine();signal.throwIfAborted();ffmpeg=new globalThis.FFmpegWASM.FFmpeg();
   progress({phase:'load',message:'Đang nạp bộ xuất MP4 local…'});await ffmpeg.load({coreURL:new URL('../vendor/mooz/ffmpeg/ffmpeg-core.js',import.meta.url).href,wasmURL:new URL('../vendor/mooz/ffmpeg/ffmpeg-core.wasm',import.meta.url).href});signal.throwIfAborted();
   const input=document.createElement('canvas');input.width=input.height=256;const inputCtx=input.getContext('2d',{willReadFrequently:true});
   const gray=document.createElement('canvas');gray.width=gray.height=256;const grayCtx=gray.getContext('2d');const output=document.createElement('canvas');output.width=width;output.height=height;const outCtx=output.getContext('2d');
   let range=null,previousColors=null;
   for(let index=0;index<total;index++){
    signal.throwIfAborted();const time=Math.min(start+index/fps,Math.max(start,video.duration-.002));
    if(Math.abs(video.currentTime-time)>.0001)await waitEvent(video,'seeked',signal,()=>{video.currentTime=time;});
    inputCtx.drawImage(video,0,0,256,256);const rgba=inputCtx.getImageData(0,0,256,256).data;
    const colors=new Float32Array(64*3);for(let i=0;i<64;i++){const p=(Math.floor(i/8)*32*256+(i%8)*32)*4;for(let c=0;c<3;c++)colors[i*3+c]=rgba[p+c]/255;}
    const cut=previousColors&&colors.reduce((sum,value,i)=>sum+Math.abs(value-previousColors[i]),0)/colors.length>.18;previousColors=colors;
    const result=await ask('infer',{rgba});signal.throwIfAborted();
    const normalized=depthPixels(result.depth,range,{invert:!!options.invert,stabilize:options.stabilize!==false,reset:cut});range=normalized.range;
    grayCtx.putImageData(new ImageData(normalized.pixels,256,256),0,0);outCtx.drawImage(gray,0,0,width,height);
    const png=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!png)throw Error('Không xuất được khung độ sâu.');
    await ffmpeg.writeFile('/depth_'+String(index).padStart(6,'0')+'.png',new Uint8Array(await png.arrayBuffer()));
    progress({phase:'frames',current:index+1,total,message:`Đang ước lượng độ sâu ${index+1} / ${total} khung hình`});
   }
   worker.terminate();worker=null;signal.throwIfAborted();
   const args=['-framerate',String(fps),'-i','/depth_%06d.png'];
   if(options.keepAudio){progress({phase:'encode',message:'Đang đọc âm thanh gốc…'});await ffmpeg.writeFile('/source.bin',new Uint8Array(await asset.blob.arrayBuffer()));args.push('-ss',String(start),'-i','/source.bin');}
   args.push('-map','0:v:0');if(options.keepAudio)args.push('-map','1:a:0?','-c:a','aac','-b:a','128k');
   args.push('-vf','fps=24,format=yuv420p','-c:v','libx264','-preset','ultrafast','-crf','18','-t',String(duration),'-movflags','+faststart','-y','/depth.mp4');
   progress({phase:'encode',message:'Đang ghép các khung độ sâu thành MP4…'});
   const code=await ffmpeg.exec(args);signal.throwIfAborted();if(code!==0)throw Error('Không xuất được MP4 chiều sâu.');
   const bytes=await ffmpeg.readFile('/depth.mp4');if(!bytes?.length)throw Error('Tệp chiều sâu xuất ra trống.');
   return {blob:new Blob([bytes],{type:'video/mp4'}),frames:total,width,height,fps:24,analysisFps:fps,duration,model:'MiDaS v2.1 Small',report:`Bản đồ độ sâu tương đối, ${options.invert?'gần tối / xa sáng':'gần sáng / xa tối'}. MiDaS Small phân tích ${total} khung tại ${fps} FPS; xuất MP4 24 FPS. Không phải khoảng cách theo mét; dự đoán từng khung có thể dao động.`,sourceId:asset.id};
  }catch(error){if(signal.aborted)throw abortError();throw error;}finally{signal.removeEventListener('abort',stop);stop();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
 };
 return navigator.locks.request('mooz-cvn-depth-video',{ifAvailable:true},execute);
}
