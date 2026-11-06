const assert=require('node:assert/strict');
exports.checkComposerOverlap=async page=>{
 const origin=new URL(page.url()).origin;await page.goto(origin);
 const id=await page.evaluate(async()=>{localStorage.setItem('mooz-cvn-appearance',JSON.stringify({theme:'light'}));const{createProject,ProjectRepository}=await import('./core/projects.js');const p=createProject('Composer overlap');p.graph.nodes=[{id:'over-script',type:'generateText',x:200,y:120,data:{customName:'Kịch bản'}},{id:'over-video',type:'generateVideo',x:240,y:420,data:{customName:'Video che bên dưới',size:'16:9'}}];await new ProjectRepository().save(p,{create:true});return p.id;});
 await page.reload();
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
 await page.goto(origin+'/#canvas/'+id);const script=page.locator('[data-id="over-script"]'),video=page.locator('[data-id="over-video"]');await script.waitFor();await script.locator('.cvn-node-title').click();
 const shell=await page.evaluate(()=>{window.overlapShell=document.querySelector('.cvn-studio');return document.querySelector('.cvn-stage').getAttribute('style');});
 const input=script.getByLabel('Nội dung yêu cầu',{exact:true}),a=await input.boundingBox(),b=await video.locator('.cvn-node-body').boundingBox();
 const left=Math.max(a.x,b.x)+4,right=Math.min(a.x+a.width,b.x+b.width)-4,top=Math.max(a.y,b.y)+4,bottom=Math.min(a.y+a.height,b.y+b.height)-4;
 assert.ok(right>left&&bottom>top,'fixture physically overlaps composer with a later video preview');
 const point={x:(left+right)/2,y:(top+bottom)/2};
 assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.cvn-node')?.dataset.id,point),'over-script','selected composer receives clicks above neighbouring node');
 await page.mouse.click(point.x,point.y);await page.keyboard.type('Yêu cầu kịch bản vẫn nhập được');assert.equal(await input.inputValue(),'Yêu cầu kịch bản vẫn nhập được');assert.match(await input.getAttribute('placeholder'),/văn bản hoặc kịch bản/);
 const colors=await script.locator('.script-node-body').evaluate(body=>({background:getComputedStyle(body).backgroundColor,text:getComputedStyle(body.querySelector('textarea')).color}));assert.notEqual(colors.background,'rgb(36, 36, 36)','light text editor uses the light panel background');assert.notEqual(colors.background,colors.text);
 await video.locator('.cvn-node-body').click({position:{x:200,y:b.height-8}});assert.equal(await video.getAttribute('class').then(value=>value.includes('selected')),true);assert.equal(await script.locator('.inline-composer').isVisible(),false);
 await script.locator('.cvn-node-title').click();assert.equal(await input.inputValue(),'Yêu cầu kịch bản vẫn nhập được');assert.equal(await page.locator('.cvn-stage').getAttribute('style'),shell);assert.equal(await page.evaluate(()=>document.querySelector('.cvn-studio')===window.overlapShell),true);
};
