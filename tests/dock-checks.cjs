const assert = require('node:assert/strict');
exports.checkDock = async page => {
  const origin = new URL(page.url()).origin;
  const fixture = await page.evaluate(async () => {
    const { ProjectRepository, createProject } = await import('./core/projects.js');
    const { addAsset } = await import('./core/storage.js');
    const project = createProject('Dock regression'), other = createProject('Overlapping editor');
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 32;
    canvas.getContext('2d').fillRect(0,0,64,32);
    const asset = await addAsset(new File([await (await fetch(canvas.toDataURL())).blob()], 'dock.png', { type:'image/png' }), { projectId:project.id });
    project.graph.nodes.push({id:'dock-image',type:'generateImage',x:100,y:100,data:{assetId:asset.id,size:'16:9'}});
    const repo = new ProjectRepository(); await repo.save(project,{create:true}); await repo.save(other,{create:true});
    return {id:project.id,other:other.id};
  });
  await page.goto(origin+'/#canvas/'+fixture.id);
  const image = page.locator('[data-id="dock-image"]'); await image.locator('img').waitFor();
  await page.evaluate(() => {
    window.dockOriginalShell = document.querySelector('.cvn-studio'); window.dockFlashes = [];
    window.dockObserver = new MutationObserver(() => {
      if(document.querySelector('.cvn-studio') && getComputedStyle(document.querySelector('.workspace')).display!=='none') window.dockFlashes.push('dashboard exposed');
    });
    window.dockObserver.observe(document.body,{attributes:true,childList:true,subtree:true});
  });
  const dock = page.getByRole('navigation',{name:'Công cụ canvas',exact:true}), sheet=page.locator('.cvn-resource-sheet');
  const viewport = await page.locator('.cvn-stage').getAttribute('style');
  await dock.getByLabel('Di chuyển (V)',{exact:true}).click();
  await page.mouse.move(1390,70); assert.equal(await sheet.isVisible(),true,'click pins a menu beyond its hover bridge');
  await sheet.getByRole('button',{name:'Bàn tay H',exact:true}).click();
  await dock.getByLabel('Bàn tay (H)',{exact:true}).click();
  await sheet.getByRole('button',{name:'Di chuyển V',exact:true}).click();
  await image.locator('.cvn-node-title').click();
  await dock.getByLabel('Phong cách',{exact:true}).click();
  await sheet.getByRole('button',{name:'Thư viện phong cách',exact:true}).click();
  await sheet.getByRole('button',{name:'Điện ảnh',exact:true}).click();
  assert.match(await page.locator('#toast').textContent(),/Đã áp dụng phong cách/);
  await dock.getByLabel('Công cụ',{exact:true}).click();
  assert.equal(await sheet.getByRole('button',{name:'Chia lưới',exact:true}).isEnabled(),true);
  await sheet.getByRole('button',{name:'Kho tài nguyên',exact:true}).click();
  await sheet.getByRole('heading',{name:'Kho tài nguyên',exact:true}).waitFor();
  await sheet.getByRole('button',{name:'Đóng',exact:true}).click();
  for (const [label,title] of [['Phím tắt','Phím tắt'],['Trợ giúp','Trợ lý sáng tạo']]) {
    await dock.getByLabel(label,{exact:true}).click(); await sheet.getByRole('heading',{name:title,exact:true}).waitFor();
    await page.mouse.move(1390,70); assert.equal(await sheet.isVisible(),true);
    await page.mouse.click(1390,70); assert.equal(await sheet.isVisible(),false);
  }
  await page.getByRole('button',{name:'Trợ lý sáng tạo',exact:true}).click();
  await sheet.getByLabel('Tin nhắn cho trợ lý AI',{exact:true}).fill('Kiểm tra bảng trợ lý');
  await sheet.getByRole('button',{name:'Đóng',exact:true}).click();
  for(const label of ['Kho','Lịch sử']) {
    await dock.getByLabel(label,{exact:true}).click(); const library=page.locator('dialog.canvas-library[open]');await library.waitFor();
    assert.equal(await library.getByRole('button',{name:'Đóng',exact:true}).isVisible(),true);await library.getByRole('button',{name:'Đóng',exact:true}).click();
  }
  await dock.getByLabel('Thêm vào canvas',{exact:true}).click();
  await page.getByLabel('Tìm loại node',{exact:true}).fill('Văn');
  assert.equal(await page.getByRole('button',{name:'Đóng thêm node',exact:true}).isVisible(),true,'search does not break the close button');
  await page.locator('.dock-add-panel').getByRole('button',{name:'Văn bản',exact:true}).click();
  assert.equal(await page.locator('.cvn-node').count(),2);
  await dock.getByLabel('Công cụ',{exact:true}).click();
  assert.equal(await sheet.getByRole('button',{name:'Chia lưới',exact:true}).isEnabled(),false);
  await sheet.getByText('Chọn một node có ảnh trên Canvas để chỉnh sửa, chia lưới hoặc vẽ.',{exact:true}).waitFor();
  await page.mouse.click(1390,70);
  for(const [x,y]of [[1380,100],[1300,400],[900,700]])await page.mouse.click(x,y);
  assert.equal(await page.locator('.cvn-stage').getAttribute('style'),viewport,'menu and blank clicks preserve viewport');
  assert.equal(await page.evaluate(()=>window.dockOriginalShell===document.querySelector('.cvn-studio')),true);
  assert.deepEqual(await page.evaluate(()=>window.dockFlashes),[]);
  assert.equal(new URL(page.url()).hash,'#canvas/'+fixture.id);
  await image.locator('.cvn-node-title').click();await dock.getByLabel('Công cụ',{exact:true}).click();
  await sheet.getByRole('button',{name:'Chia lưới',exact:true}).click();await page.locator('dialog.image-workbench[open]').waitFor();
  // A late cleanup from an older asynchronous route must not reveal the dashboard.
  await page.evaluate(async other => {
    const {mountStudio}=await import('./studio.js');const host=document.createElement('section');document.body.append(host);
    const dispose=await mountStudio(host,other);await dispose();host.remove();
    if(!document.body.classList.contains('studio-mode'))throw Error('stale cleanup removed active Canvas mode');
    window.dockObserver.disconnect();
  },fixture.other);
  assert.equal(await page.locator('dialog.image-workbench[open]').count(),1,'stale cleanup must not close the active image editor');
  await page.locator('dialog.image-workbench[open]').getByRole('button',{name:'×',exact:true}).click();
  assert.equal(await page.locator('.cvn-studio').count(),1);
  assert.equal(await page.locator('.workspace').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>window.dockFlashes),[]);
};
