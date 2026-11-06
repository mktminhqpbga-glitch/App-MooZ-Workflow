const assert=require('node:assert/strict');
exports.checkDepthVideo=async(page,videoData,{download=true}={})=>{
 const origin=new URL(page.url()).origin;
 await page.goto(origin);
 const fixture=await page.evaluate(async data=>{const{ProjectRepository,createProject}=await import('./core/projects.js');const{addAsset}=await import('./core/storage.js');const project=createProject('Depth video regression');const blob=await(await fetch(data)).blob();const asset=await addAsset(new File([blob],'depth-source.mp4',{type:'video/mp4'}),{projectId:project.id});project.graph.nodes.push({id:'depth-source',type:'videoInput',x:180,y:160,data:{assetId:asset.id,customName:'Uploaded source'}});await new ProjectRepository().save(project,{create:true});return{id:project.id,sourceId:asset.id};},videoData);
 await page.goto(origin+'/#canvas/'+fixture.id);const source=page.locator('[data-id="depth-source"]');await source.locator('video').waitFor();await source.locator('.cvn-node-title').click();
 const viewport=await page.locator('.cvn-stage').getAttribute('style');
 await page.getByRole('button',{name:'Tạo video chiều sâu',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Tạo video chiều sâu',exact:true});await dialog.waitFor();
 const run=dialog.getByRole('button',{name:'Tạo bản đồ độ sâu',exact:true});for(let i=0;i<200&&await run.isDisabled();i++)await page.waitForTimeout(25);
 await dialog.getByLabel('Tần số phân tích',{exact:true}).selectOption('24');await run.click();await dialog.getByText(/Đang nạp model|Đang nạp bộ xuất|Đang ước lượng độ sâu/).waitFor();await dialog.getByRole('button',{name:'Hủy xử lý',exact:true}).click();await dialog.getByText('Đã hủy xử lý. Video gốc được giữ nguyên.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(async id=>{const{list}=await import('./core/storage.js');return(await list('results')).filter(asset=>asset.projectId===id&&asset.source==='local-depth').length;},fixture.id),0,'cancel leaves no saved depth output');
 await dialog.getByLabel('Tần số phân tích',{exact:true}).selectOption('2');await dialog.getByLabel('Kết thúc (giây)',{exact:true}).fill('1');await dialog.getByLabel('Giữ âm thanh gốc',{exact:true}).check();
 const external=[],ai=[];const watch=request=>{const url=request.url();if(url.startsWith('http')&&new URL(url).origin!==origin)external.push(url);if(/\/api\/(jobs|speech)$/.test(url))ai.push(url);};page.on('request',watch);
 await run.click();await dialog.getByText(/Đã lưu video chiều sâu trong Kho Kết quả/).waitFor({timeout:180000});page.off('request',watch);
 assert.deepEqual(external,[],'all weights and processing stay on the app origin');assert.deepEqual(ai,[],'depth never calls Chrome AI or a paid API');
 const output=await page.evaluate(async id=>{const{list,toDataURL,readAsset}=await import('./core/storage.js');const asset=(await list('results')).find(asset=>asset.projectId===id&&asset.source==='local-depth');return {id:asset.id,sourceId:asset.derivedFrom,processing:asset.processing,data:await toDataURL(asset.blob),original:await toDataURL((await readAsset(asset.derivedFrom)).blob)};},fixture.id);
 assert.equal(output.sourceId,fixture.sourceId);assert.equal(output.original,videoData,'source bytes remain unchanged');assert.equal(output.processing.frames,2);assert.equal(output.processing.model,'MiDaS v2.1 Small');assert.equal(output.processing.outputFps,24);
 const preview=dialog.locator('.post-preview video').last();const duration=await preview.evaluate(video=>new Promise((resolve,reject)=>{if(video.readyState>=1)return resolve(video.duration);video.onloadedmetadata=()=>resolve(video.duration);video.onerror=()=>reject(Error('Depth MP4 did not decode'));}));assert.ok(Math.abs(duration-1)<.08);
 await dialog.getByLabel('Đảo gần / xa',{exact:true}).check();assert.equal(await dialog.getByRole('button',{name:'Thêm vào Canvas',exact:true}).isDisabled(),true);await dialog.getByLabel('Đảo gần / xa',{exact:true}).uncheck();assert.equal(await dialog.getByRole('button',{name:'Thêm vào Canvas',exact:true}).isEnabled(),true);
 if(download){const event=page.waitForEvent('download');await dialog.getByRole('button',{name:'Tải MP4 chiều sâu',exact:true}).click();const file=await event;assert.ok(file.suggestedFilename().endsWith('.mp4'));assert.equal(await file.failure(),null);}
 await dialog.getByRole('button',{name:'Thêm vào Canvas',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.cvn-node-body video').length===2);
 assert.equal(await page.locator('.cvn-stage').getAttribute('style'),viewport,'depth output does not change zoom or pan');
 assert.equal(await source.locator('video').count(),1);return output;
};
