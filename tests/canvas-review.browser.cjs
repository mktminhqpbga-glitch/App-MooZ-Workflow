const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile, mkdtemp, rm, mkdir } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mooz-review-'));
  const videoPath = path.join(temporary, 'sample.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x32:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath]);
  const video = 'data:video/mp4;base64,' + (await readFile(videoPath)).toString('base64');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/api/status') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ providers: [], chrome: { connected: false } })); return; }
      if (pathname.startsWith('/api/tabs')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('[]'); return; }
      const file = path.join(__dirname, '..', 'dist', pathname === '/' ? 'index.html' : pathname);
      const content = await readFile(file);
      response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); response.end(content);
    } catch { response.writeHead(404); response.end('Missing file'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const fixture = await page.evaluate(async video => {
      const { ProjectRepository, createProject } = await import('./core/projects.js');
      const { addAsset, write } = await import('./core/storage.js');
      const project = createProject('Rà soát Canvas');
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d');
      const makeImage = async (name, color, projectId = project.id, source = 'upload') => {
        context.fillStyle = color; context.fillRect(0, 0, 160, 90);
        const blob = await (await fetch(canvas.toDataURL())).blob();
        return addAsset(new File([blob], name, { type: 'image/png' }), { projectId, source });
      };
      const a = await makeImage('ảnh đỏ.png', '#d64747'), b = await makeImage('ảnh xanh.png', '#4276d4');
      const videoBlob = await (await fetch(video)).blob();
      const v = await addAsset(new File([videoBlob], 'video.mp4', { type: 'video/mp4' }), { projectId: project.id });
      await makeImage('kết quả dự án.png', '#60a060', project.id, 'ai');
      await makeImage('kết quả dự án khác.png', '#303030', 'foreign', 'ai');
      await write('characters', { id: 'person-red', name: 'Nhân vật đỏ', assetId: a.id, createdAt: new Date().toISOString() });
      project.graph.nodes = [
        { id: 'src-a', type: 'imageInput', x: 0, y: 0, data: { customName: 'Ảnh đỏ', assetId: a.id } },
        { id: 'src-b', type: 'imageInput', x: 0, y: 400, data: { customName: 'Ảnh xanh', assetId: b.id } },
        { id: 'src-v', type: 'videoInput', x: 0, y: 750, data: { customName: 'Video mẫu', assetId: v.id } },
        { id: 'image-target', type: 'generateImage', x: 640, y: 100, data: { customName: 'Tạo ảnh', size: '16:9', provider: 'openai' } },
        { id: 'video-target', type: 'generateVideo', x: 1280, y: 100, data: { customName: 'Tạo video', size: '16:9', provider: 'muse' } },
        { id: 'empty-target', type: 'generateImage', x: 1900, y: 100, data: { customName: 'Node trống', size: '16:9', provider: 'openai' } },
      ];
      project.graph.viewport = { x: 100, y: 100, zoom: .65 };
      await new ProjectRepository().save(project, { create: true });
      return { id: project.id, image: canvas.toDataURL().split(',')[1] };
    }, video);
    await page.goto(url + '/#canvas/' + fixture.id);
    const image = page.locator('.cvn-node[data-id="image-target"]'), toolbar = page.locator('.cvn-image-toolbar');
    await image.locator('.cvn-node-title').click();
    assert.equal(await toolbar.isVisible(), true, 'empty selected node has toolbar');
    const bar = await toolbar.boundingBox(), prompt = await image.locator('.inline-composer').boundingBox();
    assert.ok(bar.width < prompt.width * .9, 'toolbar shrinks rather than spanning prompt width');
    const groups = await toolbar.locator('.image-primary-tools,.image-utility-tools').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    assert.ok(groups[1].left - groups[0].right < 24, 'no large empty gap between action groups');
    await image.getByRole('button', { name: 'Tham chiếu', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.canvas-reference-card').length === 3);
    assert.equal(await image.locator('.canvas-reference-card img').count(), 2);
    assert.equal(await image.locator('.canvas-reference-card video').count(), 1);
    const boxes = await image.locator('.canvas-reference-card').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
    assert.equal(boxes[0].y, boxes[1].y, 'reference thumbnails are horizontal');
    assert.ok(boxes[1].x > boxes[0].x);
    await image.getByRole('button', { name: 'Ảnh: ảnh đỏ.png', exact: true }).click();
    await image.locator('.inline-refs img').waitFor();
    await image.getByRole('button', { name: 'Video: video.mp4', exact: true }).click();
    await image.locator('.inline-refs video').waitFor();
    if (process.env.REVIEW_DIR) {
      await mkdir(process.env.REVIEW_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.REVIEW_DIR, 'reference-picker-review.png') });
    }
    await image.getByLabel('Đóng bảng tham chiếu', { exact: true }).click();
    assert.equal(await image.locator('.inline-chooser').isVisible(), false);
    const templates = image.getByLabel('Mẫu tạo nội dung', { exact: true });
    await templates.click();
    const editor = page.locator('.cvn-resource-sheet');
    await editor.getByRole('button', { name: 'Đóng', exact: true }).waitFor();
    assert.equal(await editor.locator('.creation-template-columns').count(), 1);
    await templates.click(); assert.equal(await editor.isVisible(), false, 'second click closes');
    await templates.click(); await editor.getByRole('button', { name: 'Đóng', exact: true }).click();
    assert.equal(await editor.isVisible(), false, 'explicit close works');
    await templates.dblclick(); assert.equal(await editor.isVisible(), true, 'double click does not toggle twice');
    await templates.click(); assert.equal(await editor.isVisible(), false);
    await image.getByLabel('Ống kính và máy ảnh', { exact: true }).click();
    await page.getByLabel('Tiêu cự', { exact: true }).selectOption('85');
    await page.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    assert.ok((await image.getByLabel('Ống kính và máy ảnh').getAttribute('title')).includes('85'));
    const mode = page.locator('.cvn-dock > .dock-selected');
    await mode.hover();
    await page.locator('.pointer-tool-menu').getByRole('button', { name: /Bàn tay/ }).click();
    assert.equal(await mode.getAttribute('data-mode'), 'hand');
    const hand = await mode.locator('svg path').getAttribute('d');
    await page.keyboard.press('v');
    assert.equal(await mode.getAttribute('data-mode'), 'pointer');
    assert.notEqual(await mode.locator('svg path').getAttribute('d'), hand);
    const title = await image.locator('.cvn-node-title').boundingBox();
    await page.mouse.move(title.x + 15, title.y + 5); await page.mouse.down(); await page.mouse.move(title.x + 35, title.y + 25, { steps: 4 });
    assert.equal(await toolbar.isVisible(), false, 'toolbar hides during drag');
    assert.equal(await image.locator('.inline-composer').isVisible(), false, 'prompt hides during drag');
    await page.mouse.up();
    assert.equal(await toolbar.isVisible(), true); assert.equal(await image.locator('.inline-composer').isVisible(), true);
    assert.ok(await page.locator('.cvn-wire-flow').count() >= 2);
    await page.mouse.move(1500, 950);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-id="src-b"] > .cvn-port.output')).opacity === '0');
    const source = page.locator('[data-id="src-b"] > .cvn-port.output'), target = page.locator('[data-id="video-target"] > .cvn-port.input');
    const start = await source.boundingBox(), end = await target.boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
    assert.equal(await page.locator('.connection-draft-wire').count(), 1);
    await page.mouse.up();
    await page.waitForFunction(async id => { const { ProjectRepository } = await import('./core/projects.js'); return (await new ProjectRepository().get(id)).graph.edges.some(edge => edge.source === 'src-b' && edge.target === 'video-target'); }, fixture.id);
    await image.locator('.cvn-node-body').click({ button: 'right' });
    await page.locator('.canvas-context-menu').getByRole('menuitem', { name: /Nhân bản/ }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByLabel('Nhân vật', { exact: true }).click();
    const library = page.locator('.character-library');
    await library.locator('.character-card img').waitFor();
    assert.ok(await library.locator('.character-card img').evaluate(image => image.complete && image.naturalWidth > 0));
    await library.getByLabel('Xem lưới', { exact: true }).click();
    assert.equal(await library.locator('.character-view-grid').count(), 1);
    await library.getByRole('button', { name: '＋ Tạo nhân vật mới', exact: true }).click();
    const edit = page.locator('.character-edit-dialog');
    await edit.getByLabel('Tên nhân vật', { exact: true }).fill('Nhân vật mới');
    await edit.getByLabel('Ảnh nhân vật', { exact: true }).setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: Buffer.from(fixture.image, 'base64') });
    await edit.locator('.character-upload-preview img').waitFor();
    await edit.getByRole('button', { name: 'Lưu nhân vật', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.character-card img').length === 2);
    await library.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByLabel('Lịch sử', { exact: true }).click();
    const history = page.locator('.project-asset-library');
    await history.locator('.project-library-card').waitFor();
    assert.equal(await history.locator('.project-library-card').count(), 1, 'history defaults to this project');
    await history.getByRole('button', { name: 'Tất cả dự án', exact: true }).click();
    assert.equal(await history.locator('.project-library-card').count(), 2);
    await history.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByLabel('Quản lý tài sản', { exact: true }).click();
    assert.equal(await page.locator('.canvas-assets-drawer').isVisible(), true);
    await page.locator('.canvas-assets-drawer').getByLabel('Thu bảng tài sản', { exact: true }).first().click();
    assert.equal(await page.locator('.canvas-assets-drawer').isVisible(), false);
    assert.deepEqual(errors, []);
    if (process.env.REVIEW_DIR) { await mkdir(process.env.REVIEW_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.REVIEW_DIR, 'canvas-review.png') }); }
    console.log('PASS built static app: compact toolbar, visual references, close/toggle, camera, pointer icon, drag panels/wires, context menu, character upload/grid, project history and asset drawer. No live AI.');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
