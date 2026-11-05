/* Local media processing; remote speech requests occur only on explicit execution. */
(()=>{
 const video={id:'video',label:'Video',type:'video'},audio={id:'audio',label:'Âm thanh',type:'audio'},text={id:'text',label:'Văn bản',type:'text'};
 const definitions={
  finalOutput:{title:'Tổng hợp video',inputs:[{...video,label:'Các video'},{...audio,label:'Nhạc / lời đọc'}],outputs:[video]},
  frameFit:{title:'Khung hình · đổi tỷ lệ',inputs:[video],outputs:[video]},
  watermark:{title:'Logo / dấu bản quyền',inputs:[video,{id:'reference',label:'Logo',type:'image'}],outputs:[video]},
  audioInput:{title:'Âm thanh đầu vào',outputs:[audio]},
  audioMix:{title:'Âm thanh / nhạc nền',inputs:[video,audio],outputs:[video]},
  subtitles:{title:'Phụ đề',inputs:[video,text],outputs:[video,text]},
  voiceover:{title:'Lồng tiếng · OpenAI',inputs:[text],outputs:[audio]},
  voiceSync:{title:'Đồng bộ lời đọc – cảnh',inputs:[{...video,label:'Các cảnh'},{...audio,label:'Các bản đọc'},text],outputs:[video]},
  transition:{title:'Chuyển cảnh',inputs:[{...video,id:'first',label:'Cảnh trước'},{...video,id:'second',label:'Cảnh sau'}],outputs:[video]},
  speed:{title:'Điều chỉnh tốc độ',inputs:[video],outputs:[video]},
  videoTrim:{title:'Cắt video',inputs:[video],outputs:[video]},
  videoRotate:{title:'Xoay / lật video',inputs:[video],outputs:[video]},
  videoColor:{title:'Chỉnh màu video',inputs:[video],outputs:[video]},
  audioExtract:{title:'Tách âm thanh',inputs:[video],outputs:[audio]},
  workflowTemplate:{title:'Mẫu workflow',inputs:[],outputs:[]}
 };
 const localEdits=new Set(['videoTrim','videoRotate','videoColor','audioExtract']);
 const effects=new Set(['finalOutput','audioMix','subtitles','voiceover','voiceSync','transition','speed','frameFit','watermark',...localEdits]);
 const finite=(value,min,max,label)=>{const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error(`${label}: cần số từ ${min} đến ${max}.`);return n;};
 function editPlan(type,settings={},duration){
  if(type==='videoTrim'){
   finite(duration,.05,86400,'Thời lượng nguồn');const start=finite(settings.trimStart??0,0,duration,'Bắt đầu'),end=finite(settings.trimEnd==null||settings.trimEnd===''||Number(settings.trimEnd)===0?duration:settings.trimEnd,0,duration,'Kết thúc');
   if(end-start<.05)throw Error('Kết thúc phải sau bắt đầu ít nhất 0,05 giây.');return {start,end,duration:end-start};
  }
  if(type==='videoRotate'){
   const angle=Number(settings.rotation??0);if(![0,90,180,270].includes(angle))throw Error('Góc xoay phải là 0, 90, 180 hoặc 270 độ.');
   const filters=angle===90?['transpose=clock']:angle===180?['hflip','vflip']:angle===270?['transpose=cclock']:[];if(settings.flipHorizontal===true)filters.push('hflip');return {filters,swap:angle===90||angle===270};
  }
  if(type==='videoColor')return {brightness:finite(settings.brightness??0,-.5,.5,'Độ sáng'),contrast:finite(settings.contrast??1,.1,3,'Tương phản'),saturation:finite(settings.saturation??1,0,3,'Độ bão hòa')};
  if(type==='audioExtract')return {};
  throw Error('Công cụ hậu kỳ không được hỗ trợ.');
 }
 function parseSrt(value){
  const raw=String(value||'').replace(/^\uFEFF/,'').replace(/\r/g,'').trim();if(!raw)throw Error('Chưa có phụ đề SRT.');
  const seconds=value=>{const m=/^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);if(!m||+m[2]>59||+m[3]>59)throw Error('Mốc thời gian SRT không hợp lệ.');return +m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000;};
  let previous=0;return raw.split(/\n\s*\n/).map(block=>{const lines=block.split('\n');if(/^\d+$/.test(lines[0].trim()))lines.shift();const match=/^(\S+)\s+-->\s+(\S+)\s*$/.exec(lines.shift()||'');if(!match)throw Error('Phụ đề cần định dạng SRT: 00:00:01,000 --> 00:00:02,000.');const start=seconds(match[1]),end=seconds(match[2]),text=lines.join('\n').trim();if(end<=start||start<previous||!text)throw Error('Phụ đề phải có nội dung, thời gian tăng dần và không chồng nhau.');previous=end;return {start,end,text};});
 }
 const timestamp=seconds=>{let n=Math.round(seconds*1000);const h=Math.floor(n/3600000);n%=3600000;const m=Math.floor(n/60000);n%=60000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(Math.floor(n/1000)).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};
 const srt=cues=>cues.map((c,i)=>`${i+1}\n${timestamp(c.start)} --> ${timestamp(c.end)}\n${c.text}`).join('\n\n');
 function tempo(speed){let n=finite(speed,.25,4,'Tốc độ'),out=[];while(n>2){out.push('atempo=2');n/=2;}while(n<.5){out.push('atempo=0.5');n/=.5;}out.push('atempo='+n);return out.join(',');}
 function sceneDurations(total,count,lines=[]){finite(total,.05,86400,'Thời lượng lời đọc');if(!count)throw Error('Chưa có cảnh video.');if(lines.length&&lines.length!==count)throw Error('Mỗi dòng kịch bản phải tương ứng một cảnh.');const weights=lines.length?lines.map(line=>Math.max(1,line.trim().split(/\s+/).length)):Array(count).fill(1),sum=weights.reduce((a,b)=>a+b,0);return weights.map(w=>total*w/sum);}
 function extensionPlan(actual,target,provider='muse'){
  finite(actual,.1,86400,'Clip nguồn');finite(target,.1,86400,'Thời lượng mục tiêu');if(target<=actual+.05)throw Error('Clip nguồn đã đủ thời lượng.');if(!['muse','google'].includes(provider))throw Error('AI này chưa có luồng tiếp nối.');
  const step=provider==='google'?8:Math.max(5,Math.min(10,Math.round(actual))),remaining=target-actual,count=Math.ceil(remaining/step);if(count>12)throw Error('Chia tối đa 12 đoạn tiếp nối; chọn mục tiêu ngắn hơn.');
  return Array.from({length:count},(_,i)=>provider==='google'?([4,6,8].find(d=>d>=Math.min(8,remaining-i*step))||8):step);
 }
 function sourceFormat(base){
  const width=finite(base.width,1,16384,'Độ rộng video'),height=finite(base.height,1,16384,'Độ cao video'),stream=base.streams?.find(s=>s.codec_type==='video');
  const valid=rate=>{const match=/^(\d+)(?:\/(\d+))?$/.exec(String(rate||'')),fps=match&&Number(match[2]||1)>0?Number(match[1])/Number(match[2]||1):0;return fps>=1&&fps<=120;};
  const rate=[stream?.r_frame_rate,stream?.avg_frame_rate,'30'].find(valid);
  return {width:Math.ceil(width/2)*2,height:Math.ceil(height/2)*2,fps:String(rate)};
 }
 function finalVideoSources(nodes,edges,outputId,timeline=[]){
  const kinds=new Set(['generateVideo','audioMix','subtitles','voiceSync','transition','speed','videoAssembly','frameFit','watermark','videoTrim','videoRotate','videoColor']),processors=new Set([...kinds].filter(k=>k!=='generateVideo')),byId=new Map(nodes.map(n=>[n.id,n]));
  const ready=n=>!!n?.data?.asset?.url&&n.data.asset.kind==='video'&&!n.data.storyDirty&&!['running','queued','error','stopped'].includes(n.data.status);
  if(timeline.length)return [...new Set(timeline)].map(id=>byId.get(id)).filter(n=>n&&n.id!==outputId&&(ready(n)||n.type==='videoInput'&&n.data.localDataUrl));
  return nodes.filter(n=>n.id!==outputId&&kinds.has(n.type)&&!edges.some(e=>e.source===n.id&&e.target!==outputId&&['video','first','second'].includes(e.targetPort)&&processors.has(byId.get(e.target)?.type))&&ready(n));
 }
 let queue;
 async function process(type,{videos=[],audios=[],images=[],settings={},captions='',lines=[]}={},signal,progress=()=>{}){
  if(localEdits.has(type)&&(videos.length!==1||audios.length||images.length))throw Error('Công cụ này cần đúng một video đầu vào.');
  queue ||= WorkflowRuntime.queue();const release=await queue.acquire('ffmpeg-studio',signal,()=>progress('Đợi bộ xử lý video cục bộ…'));
  let ffmpeg,abort;try{
   if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');
   ffmpeg=new FFmpegWASM.FFmpeg();abort=()=>ffmpeg.terminate();signal?.addEventListener('abort',abort,{once:true});let tail=[];
   ffmpeg.on('log',e=>{tail.push(e.message);if(tail.length>8)tail.shift();});ffmpeg.on('progress',e=>progress('Đang xử lý '+Math.max(0,Math.min(99,Math.round((e.progress||0)*100)))+'%'));
   await ffmpeg.load({coreURL:new URL('./ffmpeg/ffmpeg-core.js', import.meta.url).href,wasmURL:new URL('./ffmpeg/ffmpeg-core.wasm', import.meta.url).href},{signal});
   const sources=[...videos,...audios,...images],info=[],paths=[];
   for(const [i,asset] of sources.entries()){
    if(!asset?.url)throw Error('Thiếu tệp đầu vào.');const r=await fetch(asset.url,{signal,credentials:'include'});if(!r.ok)throw Error('Không đọc được tệp đầu vào.');const bytes=new Uint8Array(await r.arrayBuffer());if(!bytes.length)throw Error('Tệp đầu vào trống.');if(bytes.length>100*1024*1024)throw Error('Tệp đầu vào vượt 100 MB.');
    const file='/input'+i+'.bin';paths.push(file);await ffmpeg.writeFile(file,bytes,{signal});
    const code=await ffmpeg.ffprobe(['-v','error','-show_entries','stream=codec_type,codec_name,profile,level,pix_fmt,width,height,r_frame_rate,avg_frame_rate,time_base,sample_rate,channels,channel_layout:format=duration','-of','json',file,'-o','/probe.json'],-1,{signal});const probe=JSON.parse(await ffmpeg.readFile('/probe.json','utf8',{signal})),v=probe.streams?.find(s=>s.codec_type==='video'),a=probe.streams?.some(s=>s.codec_type==='audio'),duration=Number(probe.format?.duration);if(i>=videos.length+audios.length){if(!v||!['png','mjpeg','webp'].includes(v.codec_name))throw Error('Logo phải là ảnh PNG/JPEG/WebP.');info.push({width:v.width,height:v.height,audio:false,duration:0,streams:probe.streams});continue;}if(!Number.isFinite(duration)||duration<=0)throw Error('Không xác định được thời lượng tệp.');if(i<videos.length&&!v)throw Error('Đầu vào cảnh không phải video.');if(i>=videos.length&&!a)throw Error('Đầu vào lời đọc/nhạc không có âm thanh.');info.push({width:v?.width,height:v?.height,audio:a,duration,streams:probe.streams});
   }
   if(!videos.length)throw Error('Nối video đầu vào trước.');
   const args=[],filters=[],base=info[0],source=sourceFormat(base),initialW=source.width,initialH=source.height;let w=initialW,h=initialH;if(type==='frameFit'){const ratios={'9:16':9/16,'16:9':16/9,'1:1':1,'4:3':4/3,'3:4':3/4},ratio=Object.hasOwn(ratios,settings.size)?ratios[settings.size]:null;if(!ratio)throw Error('Tỷ lệ video không hợp lệ.');const height=Math.max(base.height,base.width/ratio),scale=Math.min(1,1280/Math.max(height,height*ratio));h=Math.max(2,Math.round(height*scale/2)*2);w=Math.max(2,Math.round(height*ratio*scale/2)*2);}const normalize=`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${source.fps},format=yuv420p`,videoOut=['-c:v','libx264','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p'],audioOut=['-c:a','aac','-b:a','160k','-ar','48000'];let report='',outputDuration=base.duration;
   paths.forEach((path,i)=>{if(type==='audioMix'&&i===videos.length&&settings.loop!==false)args.push('-stream_loop','-1');args.push('-i',path);});
   if(type==='audioExtract'){
    if(!base.audio)throw Error('Video nguồn không có luồng âm thanh để tách.');
    args.push('-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','192k','-ar','48000','-y','/audio.mp3');progress('Đang tách âm thanh MP3…');
    const code=await ffmpeg.exec(args,-1,{signal});if(code!==0)throw Error(tail.join(' ').slice(-900)||'Không tách được âm thanh.');const bytes=await ffmpeg.readFile('/audio.mp3','binary',{signal});if(!bytes.length)throw Error('Âm thanh kết quả trống.');return {blob:new Blob([bytes],{type:'audio/mpeg'}),kind:'audio',duration:base.duration,report:'Đã tách âm thanh thành MP3; '+base.duration.toFixed(2)+' giây. Video nguồn được giữ nguyên.'};
   }else if(type==='videoTrim'){
    const plan=editPlan(type,settings,base.duration);args.push('-vf',`${normalize},trim=start=${plan.start}:end=${plan.end},setpts=PTS-STARTPTS`,'-map','0:v:0');
    if(base.audio)args.push('-af',`atrim=start=${plan.start}:end=${plan.end},asetpts=PTS-STARTPTS`,'-map','0:a:0');args.push('-t',String(plan.duration));outputDuration=plan.duration;report=`Đã cắt từ ${plan.start} đến ${plan.end} giây; kết quả ${plan.duration.toFixed(2)} giây.`;
   }else if(type==='videoRotate'){
    const plan=editPlan(type,settings);args.push('-vf',[normalize,...plan.filters].join(','),'-map','0:v:0','-map','0:a?');if(plan.swap)[w,h]=[h,w];report='Đã xoay '+Number(settings.rotation||0)+'°'+(settings.flipHorizontal?' và lật ngang':'')+'; giữ thời lượng và âm thanh nguồn.';
   }else if(type==='videoColor'){
    const plan=editPlan(type,settings);args.push('-vf',`${normalize},eq=brightness=${plan.brightness}:contrast=${plan.contrast}:saturation=${plan.saturation}`,'-map','0:v:0','-map','0:a?');report='Đã chỉnh độ sáng, tương phản và bão hòa; giữ khung hình, thời lượng và âm thanh nguồn.';
   }else if(type==='watermark'){
    if(videos.length!==1||images.length!==1||audios.length)throw Error('Watermark cần đúng 1 video và 1 logo ảnh.');const percent=finite(settings.logoWidth??16,5,40,'Độ rộng logo (%)'),opacity=finite(settings.opacity??.8,.05,1,'Độ rõ logo'),margin=finite(settings.margin??20,0,100,'Lề logo'),width=Math.max(2,Math.round(w*percent/100)),positions={topRight:['main_w-overlay_w-'+margin,String(margin)],topLeft:[String(margin),String(margin)],bottomRight:['main_w-overlay_w-'+margin,'main_h-overlay_h-'+margin],bottomLeft:[String(margin),'main_h-overlay_h-'+margin]};const position=Object.hasOwn(positions,settings.position||'bottomRight')?positions[settings.position||'bottomRight']:null;if(!position)throw Error('Vị trí logo không hợp lệ.');filters.push(`[0:v]${normalize}[base]`,`[1:v]scale=${width}:-1,format=rgba,colorchannelmixer=aa=${opacity}[logo]`,`[base][logo]overlay=x=${position[0]}:y=${position[1]}:eof_action=repeat[v]`);args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[v]','-map','0:a?','-t',String(base.duration));report='Đã gắn logo '+percent+'% khung hình, giữ thời lượng '+base.duration.toFixed(2)+' giây.';
   }else if(type==='frameFit'){args.push('-vf',normalize,'-map','0:v:0','-map','0:a?');report='Đã đặt video vào khung '+settings.size+' bằng viền đệm, giữ toàn bộ hình gốc.';}else if(type==='videoAssembly'){
    const signature=x=>JSON.stringify(x.streams),compatible=!settings.targetDuration&&videos.every((_,i)=>signature(info[i])===signature(base))&&base.streams?.some(s=>s.codec_type==='video'&&s.codec_name==='h264')&&base.streams?.filter(s=>s.codec_type==='audio').every(s=>s.codec_name==='aac');
    if(compatible){
     await ffmpeg.writeFile('/concat.txt',new TextEncoder().encode(paths.slice(0,videos.length).map(path=>"file '"+path+"'").join('\n')),{signal});progress('Đang ghép trực tiếp các video cùng định dạng…');const code=await ffmpeg.exec(['-f','concat','-safe','0','-i','/concat.txt','-map','0:v:0','-map','0:a?','-c','copy','-movflags','+faststart','-y','/output.mp4'],-1,{signal});if(code!==0)throw Error(tail.join(' ').slice(-900)||'Không ghép được video.');const result=await ffmpeg.readFile('/output.mp4','binary',{signal});if(!result.length)throw Error('Video ghép trống.');return {blob:new Blob([result],{type:'video/mp4'}),duration:info.slice(0,videos.length).reduce((sum,x)=>sum+x.duration,0),width:base.width,height:base.height,report:`Đã ghép ${videos.length} video cùng định dạng, giữ nguyên hình/âm thanh, không mã hóa lại.`};
    }
    const streams=[];videos.forEach((_,i)=>{filters.push(`[${i}:v]${normalize},setpts=PTS-STARTPTS[v${i}]`);filters.push(info[i].audio?`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=duration=${info[i].duration}[a${i}]`:`anullsrc=r=48000:cl=stereo,atrim=duration=${info[i].duration}[a${i}]`);streams.push(`[v${i}][a${i}]`);});filters.push(streams.join('')+`concat=n=${videos.length}:v=1:a=1[v][a]`);args.push('-filter_complex',filters.join(';'),'-map','[v]','-map','[a]');outputDuration=info.slice(0,videos.length).reduce((sum,x)=>sum+x.duration,0);report=`Đã ghép ${videos.length} video theo thứ tự; ${outputDuration.toFixed(2)} giây. Giữ khung video đầu ${w} × ${h}, ${source.fps} fps. Clip khác khung được đặt vừa trong khung này, giữ tỷ lệ và thêm viền nếu cần.`;
   }else if(type==='speed'){
    const speed=finite(settings.speed??1,.25,4,'Tốc độ');filters.push(`[0:v]${normalize},setpts=(PTS-STARTPTS)/${speed}[v]`);if(base.audio)filters.push(`[0:a]${tempo(speed)}[a]`);args.push('-filter_complex',filters.join(';'),'-map','[v]');if(base.audio)args.push('-map','[a]');outputDuration=base.duration/speed;report=`Tốc độ ${speed}×; ${outputDuration.toFixed(2)} giây.`;
   }else if(type==='subtitles'){
    const cues=parseSrt(captions),size=finite(settings.fontSize??24,10,80,'Cỡ chữ');if(cues.at(-1).end>base.duration+.1)throw Error('Phụ đề vượt thời lượng video.');
    await ffmpeg.createDir('/fonts',{signal});const r=await fetch(new URL('./fonts/DejaVuSans.ttf', import.meta.url).href,{signal});if(!r.ok)throw Error('Không tải được phông chữ phụ đề.');await ffmpeg.writeFile('/fonts/DejaVuSans.ttf',new Uint8Array(await r.arrayBuffer()),{signal});await ffmpeg.writeFile('/captions.srt',new TextEncoder().encode(srt(cues)),{signal});
    args.push('-vf',`${normalize},subtitles=/captions.srt:fontsdir=/fonts:force_style='FontName=DejaVu Sans,FontSize=${size},Outline=2,MarginV=18'`,'-map','0:v','-map','0:a?');report=`Đã gắn ${cues.length} đoạn phụ đề; ${base.duration.toFixed(2)} giây.`;
   }else if(type==='audioMix'){
    if(audios.length!==1)throw Error('Nối một tệp nhạc hoặc lời đọc.');const music=finite(settings.musicVolume??.5,0,2,'Âm lượng nhạc'),original=settings.muteOriginal?0:finite(settings.originalVolume??1,0,2,'Âm lượng gốc');
    filters.push(`[1:a]volume=${music},aresample=48000,apad,atrim=duration=${base.duration},asetpts=PTS-STARTPTS[music]`);
    if(base.audio){filters.push(`[0:a]volume=${original},aresample=48000,asetpts=PTS-STARTPTS[original]`,'[original][music]amix=inputs=2:duration=longest:normalize=0[a]');}else filters.push('[music]anull[a]');
    const copyVideo=base.streams?.some(stream=>stream.codec_type==='video'&&stream.codec_name==='h264');if(copyVideo){videoOut.splice(0,videoOut.length,'-c:v','copy');w=base.width;h=base.height;}else args.push('-vf',normalize);args.push('-filter_complex',filters.join(';'),'-map','0:v:0','-map','[a]','-t',String(base.duration));report='Đã trộn nhạc/lời đọc với video; '+base.duration.toFixed(2)+' giây.'+(copyVideo?' Giữ nguyên hình gốc, không mã hóa lại video.':'');
   }else if(type==='transition'){
    if(videos.length!==2)throw Error('Nối đủ hai video trước và sau.');const duration=finite(settings.duration??.4,.1,5,'Thời gian chuyển'),allowed=['fade','dissolve','wipeleft','slideright'];if(!allowed.includes(settings.transition||'fade'))throw Error('Kiểu chuyển cảnh không hợp lệ.');if(duration>=Math.min(info[0].duration,info[1].duration))throw Error('Chuyển cảnh phải ngắn hơn mỗi clip.');
    videos.forEach((_,i)=>{filters.push(`[${i}:v]${normalize},settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);filters.push(info[i].audio?`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`:`anullsrc=r=48000:cl=stereo,atrim=duration=${info[i].duration}[a${i}]`);});
    filters.push(`[v0][v1]xfade=transition=${settings.transition||'fade'}:duration=${duration}:offset=${base.duration-duration}[v]`,`[a0][a1]acrossfade=d=${duration}[a]`);args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[v]','-map','[a]');outputDuration=info[0].duration+info[1].duration-duration;report=`Chuyển ${settings.transition||'fade'} ${duration}s; tổng ${outputDuration.toFixed(2)} giây.`;
   }else if(type==='voiceSync'){
    if(audios.length!==1&&audios.length!==videos.length)throw Error('Cần một bản đọc chung hoặc một bản đọc cho mỗi cảnh.');const narration=info.slice(videos.length),durations=audios.length===1?sceneDurations(narration[0].duration,videos.length,lines):narration.map(x=>x.duration);
    videos.forEach((_,i)=>{const d=durations[i],retime=settings.fit==='stretch'?`setpts=${d/info[i].duration}*(PTS-STARTPTS)`: 'setpts=PTS-STARTPTS';filters.push(`[${i}:v]${retime},${normalize},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);});filters.push(videos.map((_,i)=>`[v${i}]`).join('')+`concat=n=${videos.length}:v=1:a=0[v]`);
    if(audios.length===1)args.push('-filter_complex',filters.join(';'),'-map','[v]','-map',`${videos.length}:a:0`);else{audios.forEach((_,i)=>filters.push(`[${videos.length+i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`));filters.push(audios.map((_,i)=>`[a${i}]`).join('')+`concat=n=${audios.length}:v=0:a=1[a]`);args.push('-filter_complex',filters.join(';'),'-map','[v]','-map','[a]');}outputDuration=durations.reduce((a,b)=>a+b,0);args.push('-t',String(outputDuration));report=durations.map((d,i)=>`Cảnh ${i+1}: ${d.toFixed(2)} giây`).join('\n')+'\nĐã thay âm thanh gốc bằng lời đọc.';
   }else throw Error('Tác vụ video không được hỗ trợ.');
   if(type==='videoAssembly'&&settings.targetDuration){const target=finite(settings.targetDuration,.1,86400,'Thời lượng mục tiêu');if(outputDuration<target-.05)throw Error('Các đoạn mới dài '+outputDuration.toFixed(2)+'s, chưa đủ '+target+'s. Kiểm tra clip AI trả về; chưa xuất thiếu thời lượng.');args.push('-t',String(target));outputDuration=target;report+=' Xuất đúng mục tiêu '+target+' giây.';}
   args.push(...videoOut,...audioOut,'-movflags','+faststart','-y','/output.mp4');progress('Đang xuất MP4 cục bộ…');const code=await ffmpeg.exec(args,-1,{signal});if(code!==0)throw Error(tail.join(' ').slice(-900)||'FFmpeg không xử lý được video.');
   const result=await ffmpeg.readFile('/output.mp4','binary',{signal});if(!result.length)throw Error('Video kết quả trống.');return {blob:new Blob([result],{type:'video/mp4'}),duration:outputDuration,width:w,height:h,report};
  }catch(error){if(signal?.aborted)throw new DOMException('Đã dừng.','AbortError');throw error;}finally{signal?.removeEventListener('abort',abort);ffmpeg?.terminate();release();}
 }
 function outputOrder(ids,nodes,timeline=[],manual=[]){const known=new Map(nodes.map((n,i)=>[n.id,{node:n,index:i}])),collator=new Intl.Collator('vi',{numeric:true,sensitivity:'base'}),priority=manual.length?manual:timeline;return [...new Set(ids)].sort((a,b)=>{const ai=priority.indexOf(a),bi=priority.indexOf(b);if(ai>=0||bi>=0)return (ai<0?Infinity:ai)-(bi<0?Infinity:bi);const an=known.get(a),bn=known.get(b),label=n=>n?.node.data?.sceneLabel||n?.node.data?.customName||n?.node.data?.fileName||'';if(label(an)&&label(bn))return collator.compare(label(an),label(bn))||an.index-bn.index;return (an?.index??Infinity)-(bn?.index??Infinity);});}
 globalThis.WorkflowStudio={finalVideoSources,sourceFormat,outputOrder,definitions,effects,localEdits,editPlan,finite,parseSrt,srt,tempo,sceneDurations,extensionPlan,process};
})();
