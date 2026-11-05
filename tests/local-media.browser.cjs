const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { execFileSync } = require('node:child_process');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
 const temporary = await mkdtemp(path.join(os.tmpdir(),'mooz-local-'));
 const source = path.join(temporary,'source.mp4');
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=128x72:r=24:d=1.2','-f','lavfi','-i','sine=frequency=440:duration=1.2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
 const bytes = await readFile(source), types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.ttf':'font/ttf'};
 const server = createServer(async(req,res)=>{ try { const file=path.join(__dirname,'..','dist',new URL(req.url,'http://local').pathname);const data=await readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});res.end(data); } catch {res.writeHead(404);res.end();} });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}); const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  const results=await page.evaluate(async data=>{
   const {processMedia}=await import('./core/local-media.js');
   const blob=await(await fetch('data:video/mp4;base64,'+data)).blob(), source={id:'source',name:'source.mp4',kind:'video',blob}, results=[];
   const extracted=await processMedia('audioExtract',{videos:[source]}),audio={id:'audio',name:'voice.mp3',kind:'audio',blob:extracted.blob};
   const canvas=document.createElement('canvas');canvas.width=20;canvas.height=10;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,20,10);const logo={id:'logo',kind:'image',blob:await new Promise(resolve=>canvas.toBlob(resolve))};
   for (const [type,settings] of [['videoTrim',{trimStart:.1,trimEnd:.8}],['videoRotate',{rotation:90}],['videoColor',{saturation:0}],['speed',{speed:2}],['frameFit',{size:'1:1'}],['audioExtract',{}],['finalOutput',{}],['audioMix',{musicVolume:.2}],['subtitles',{fontSize:12}],['transition',{duration:.2,transition:'fade'}],['voiceSync',{fit:'freeze'}],['watermark',{logoWidth:25,opacity:1,margin:4}]]) {
    const result=await processMedia(type,{videos:['finalOutput','transition','voiceSync'].includes(type)?[source,source]:[source],audios:['audioMix','voiceSync'].includes(type)?[audio]:[],images:type==='watermark'?[logo]:[],captions:type==='subtitles'?'1\n00:00:00,000 --> 00:00:00,800\nXin chào Việt Nam':'',settings});
    results.push({type,size:result.blob.size,kind:result.kind||'video',mime:result.blob.type,report:result.report,bytes:await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(result.blob);})});
   }
   const abort=new AbortController();let cancelled=false;try{await processMedia('videoColor',{videos:[source],settings:{saturation:0}},abort.signal,()=>abort.abort());}catch(error){cancelled=error.name==='AbortError';}if(!cancelled)throw Error('Cancel did not abort the media operation');
   return results;
  },bytes.toString('base64'));
  for(const result of results){assert.ok(result.size>100);const file=path.join(temporary,result.type+(result.kind==='audio'?'.mp3':'.mp4'));await require('node:fs/promises').writeFile(file,Buffer.from(result.bytes,'base64'));const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));const video=metadata.streams.find(stream=>stream.codec_type==='video');assert.ok(+metadata.format.duration>0);if(result.kind==='audio')assert.equal(video,undefined);else assert.ok(video);if(result.type==='videoRotate'){assert.equal(video.width,72);assert.equal(video.height,128);}if(result.type==='videoTrim')assert.ok(+metadata.format.duration<1);if(result.type==='finalOutput')assert.ok(+metadata.format.duration>2);}
  console.log('PASS real FFmpeg WASM in Chromium: trim, rotate, color, speed, frame fit, MP3, concatenate, mix, SRT, transitions, voice synchronization, watermark and cancellation; ffprobe validates outputs.');
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
