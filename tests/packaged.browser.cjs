const { _electron: electron } = require('playwright');
const { mkdtemp, rm, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async()=>{
 const profile = await mkdtemp(path.join(os.tmpdir(),'mooz-desktop-'));
 const executablePath=process.env.MOOZ_PACKAGED_EXECUTABLE || (process.platform==='darwin'?path.resolve('artifacts/mac/MooZ CVN.app/Contents/MacOS/MooZ CVN'):path.resolve('artifacts/linux-unpacked/mooz-cvn'));
 let application;
 try{
 application=await electron.launch({executablePath,args:process.platform==='linux'?['--no-sandbox','--ozone-platform=headless','--disable-gpu']:[],env:{...process.env,MOOZ_DESKTOP_PROFILE:profile,MOOZ_DESKTOP_PORT:'17474'},timeout:45000});
 const page=await application.firstWindow();await page.waitForURL('http://127.0.0.1:17474/**');await page.locator('#main').waitFor();
 assert.equal(await page.evaluate(()=>!!window.moozDesktop?.accessCode),true);
 assert.equal(await page.evaluate(()=>window.moozDesktop.version),require('../package.json').version);
 const status=await page.evaluate(async()=>{const {api}=await import('./client-api.js');return api('status');});assert.ok(status.chrome);
 await page.goto('http://127.0.0.1:17474/#settings');await page.getByText('Ứng dụng & extension',{exact:true}).waitFor();
 const saved=path.join(profile,'MooZ-Connect.zip');
 await application.evaluate(({BrowserWindow},target)=>{globalThis.moozDownloadPromise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native download did not finish')),15000);BrowserWindow.getAllWindows()[0].webContents.session.once('will-download',(_event,item)=>{item.setSavePath(target);item.once('done',(_event,state)=>{clearTimeout(timer);resolve(state);});});});return true;},saved);
 await page.locator('.app-downloads').getByRole('link',{name:/Tải MooZ Connect/}).click();
 assert.equal(await application.evaluate(()=>globalThis.moozDownloadPromise),'completed');
 const bytes=await require('node:fs/promises').readFile(saved);assert.equal(bytes.subarray(0,2).toString(),'PK');
 await page.goto('http://127.0.0.1:17474/#images');await page.getByRole('form',{name:'Luồng làm việc',exact:true}).waitFor();assert.equal(await page.locator('.batch-form').count(),1);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:17474/#post');await page.getByRole('heading',{name:'Hậu kỳ video',exact:true}).waitFor();assert.deepEqual(errors,[]);
 const fixture=path.join(profile,'fixture.mp4'), output=path.join(profile,'trimmed.mp4');
 const{execFileSync}=require('node:child_process');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=128x72:r=24:d=1.2','-c:v','libx264','-pix_fmt','yuv420p',fixture]);
 const processed=await page.evaluate(async data=>{const{processMedia}=await import('./core/local-media.js');const{toDataURL}=await import('./core/storage.js');const blob=await(await fetch(data)).blob();const result=await processMedia('videoTrim',{videos:[{blob,name:'fixture.mp4',kind:'video'}],settings:{trimStart:.2,trimEnd:.8}});return toDataURL(result.blob);},'data:video/mp4;base64,'+(await readFile(fixture)).toString('base64'));
 await writeFile(output,Buffer.from(processed.split(',')[1],'base64'));
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',output],{encoding:'utf8'}));assert.ok(+probe.format.duration>=.5&&+probe.format.duration<.8,'packaged WASM processes actual MP4');
 await require('./dock-checks.cjs').checkDock(page);
 await require('./composer-overlap-checks.cjs').checkComposerOverlap(page);
 await require('./relay-settings-checks.cjs').checkRelaySettings(page);
 await require('./relay-settings-checks.cjs').checkRelayBusyGuard(page);
 const depthOutput=await require('./depth-video-checks.cjs').checkDepthVideo(page,'data:video/mp4;base64,'+(await readFile(fixture)).toString('base64'),{download:false});
 const depthFile=path.join(profile,'depth.mp4');await writeFile(depthFile,Buffer.from(depthOutput.data.split(',')[1],'base64'));
 const depthProbe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',depthFile],{encoding:'utf8'}));assert.equal(depthProbe.streams.find(stream=>stream.codec_type==='video').codec_name,'h264');assert.ok(Math.abs(+depthProbe.format.duration-1)<.08);
 assert.deepEqual(errors,[]);
 console.log('PASS packaged Electron application: embedded secured server, sandboxed renderer, Settings downloads ZIP, single fluid workspace, post-production route and actual bundled WASM MP4 processing, every dock group, stable Canvas cleanup/composer stacking, private relay Settings with busy-job guard, and real bundled MiDaS depth MP4.');
 }finally{await application?.close();await rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
