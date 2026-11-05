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
    let assistant = null, workflowRequests = 0, assistantRequests = 0;
    const availableTabs = [
      { id: 8, title: 'Tab trợ lý kiểm chứng', url: 'https://grok.com/chat/assistant' },
      { id: 9, title: 'Tab làm việc kiểm chứng', url: 'https://grok.com/chat/work' },
    ];
    await page.route('**/api/status', route => route.fulfill({ json: { providers: [{ id: 'openai', ready: true, types: ['text', 'image'] }], chrome: { connected: true } } }));
    await page.route('**/api/tabs?*', route => route.fulfill({ json: ['muse', 'grok'].includes(new URL(route.request().url()).searchParams.get('provider')) ? availableTabs : [] }));
    await page.route('**/api/assistant/config', route => {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON().tab;
        const tab = input && availableTabs.find(tab => tab.id === input.tabId);
        assistant = tab ? { provider: input.provider, tabId: tab.id, title: tab.title, chatURL: tab.url } : null;
      }
      return route.fulfill({ json: { assistantTab: assistant } });
    });
    await page.route('**/api/jobs', route => { workflowRequests++; return route.fulfill({ json: { status: 'error', error: 'This should not be reached for the reserved tab' } }); });
    await page.route('**/api/assistant/messages', route => { assistantRequests++; return route.fulfill({ json: { status: 'success', result: { kind: 'text', text: 'Đã nhận yêu cầu trên tab trợ lý.' } } }); });
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
    const openingMetadata = await page.evaluate(async id => {
      const { ProjectRepository } = await import('./core/projects.js');
      const repo = new ProjectRepository(), before = await repo.get(id);
      const opened = await new ProjectRepository().markOpened(id);
      const saved = await repo.save(before);
      return { revision: before.revision, opened: opened.revision, saved: saved.revision, timestamp: saved.lastOpenedAt === opened.lastOpenedAt };
    }, fixture.id);
    assert.equal(openingMetadata.opened, openingMetadata.revision);
    assert.equal(openingMetadata.saved, openingMetadata.revision + 1);
    assert.equal(openingMetadata.timestamp, true);
    // Reopen after the independent metadata/content writer to refresh this editor.
    await page.reload();
    const image = page.locator('.cvn-node[data-id="image-target"]'), toolbar = page.locator('.cvn-image-toolbar');
    await page.locator('[data-id="src-b"] .cvn-node-body > img').waitFor();
    const beforeSelection = await page.locator('.cvn-stage').getAttribute('style');
    const firstSource = await page.locator('[data-id="src-a"] .cvn-node-body').boundingBox(), secondSource = await page.locator('[data-id="src-b"] .cvn-node-body').boundingBox();
    await page.mouse.move(firstSource.x - 15, firstSource.y + 5);
    await page.mouse.down();
    await page.mouse.move(secondSource.x + secondSource.width + 10, secondSource.y + secondSource.height - 5, { steps: 5 });
    assert.equal(await page.locator('.cvn-selection-box').isVisible(), true);
    await page.mouse.up();
    assert.equal(await page.locator('.cvn-selection-box').isVisible(), false);
    assert.equal(await page.locator('.cvn-node.selected').count(), 2, 'left drag selects multiple nodes');
    assert.equal(await page.locator('.cvn-stage').getAttribute('style'), beforeSelection, 'left selection never pans or zooms Canvas');
    await image.locator('.cvn-node-title').click();
    assert.equal(await toolbar.isVisible(), true, 'empty selected node has toolbar');
    const bar = await toolbar.boundingBox(), prompt = await image.locator('.inline-composer').boundingBox();
    assert.ok(bar.width < prompt.width * .9, 'toolbar shrinks rather than spanning prompt width');
    const groups = await toolbar.locator('.image-primary-tools,.image-utility-tools').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    assert.ok(groups[1].left - groups[0].right < 24, 'no large empty gap between action groups');
    for (const node of [image, page.locator('[data-id="video-target"]')]) {
      await node.locator('.cvn-node-title').click();
      const transform = await page.locator('.cvn-stage').getAttribute('style');
      const expand = node.getByLabel('Mở rộng prompt', { exact: true });
      await expand.click();
      assert.equal(await expand.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.cvn-stage').getAttribute('style'), transform, 'expanding image/video prompt preserves zoom and pan');
      await expand.click();
      assert.equal(await expand.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.cvn-stage').getAttribute('style'), transform, 'collapsing prompt preserves zoom and pan');
    }
    await image.locator('.cvn-node-title').click();
    await image.locator('.inline-settings > summary').click();
    const optionsPanel = image.locator('.generation-options-panel');
    await optionsPanel.waitFor();
    const optionsBox = await optionsPanel.boundingBox(), optionsAnchor = await image.locator('.inline-settings > summary').boundingBox(), overlappingToolbar = await toolbar.boundingBox();
    assert.ok(optionsBox.y >= 10 && optionsBox.y + optionsBox.height < optionsAnchor.y, 'settings stays above its trigger and inside the viewport');
    const overlap = { left: Math.max(optionsBox.x, overlappingToolbar.x), right: Math.min(optionsBox.x + optionsBox.width, overlappingToolbar.x + overlappingToolbar.width), top: Math.max(optionsBox.y, overlappingToolbar.y), bottom: Math.min(optionsBox.y + optionsBox.height, overlappingToolbar.y + overlappingToolbar.height) };
    assert.ok(overlap.right > overlap.left && overlap.bottom > overlap.top, 'fixture reproduces overlapping popup and toolbar');
    assert.equal(await optionsPanel.evaluate((panel, area) => panel.contains(document.elementFromPoint((area.left + area.right) / 2, (area.top + area.bottom) / 2)), overlap), true, 'settings paints above the image toolbar');
    await optionsPanel.evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
    await optionsPanel.getByRole('group', { name: 'Số lượng ảnh', exact: true }).getByRole('button', { name: '2 ảnh', exact: true }).click();
    await optionsPanel.getByLabel('Đóng thông số', { exact: true }).click();
    assert.equal(await optionsPanel.isVisible(), false);
    assert.ok((await page.locator('.cvn-stage').getAttribute('style')).includes('scale(0.65)'), 'settings never changes zoom');
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
    const topStyle = image.locator('.inline-tools').getByRole('button', { name: 'Phong cách', exact: true });
    await topStyle.click();
    const stylePopup = page.locator('.cvn-resource-sheet');
    const styleBox = await stylePopup.boundingBox(), styleAnchor = await topStyle.boundingBox(), closeBox = await stylePopup.getByRole('button', { name: 'Đóng', exact: true }).boundingBox();
    assert.ok(styleBox.y + styleBox.height <= styleAnchor.y, 'top-row style opens above its trigger');
    assert.ok(closeBox.x > styleBox.x + styleBox.width / 2 && closeBox.y < styleBox.y + 50, 'close is at the upper right');
    await topStyle.click(); assert.equal(await stylePopup.isVisible(), false);
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
    const beforeHandPan = await page.locator('.cvn-stage').getAttribute('style');
    await page.mouse.move(1450, 850); await page.mouse.down();
    await page.mouse.move(1460, 860, { steps: 3 }); await page.mouse.up();
    assert.notEqual(await page.locator('.cvn-stage').getAttribute('style'), beforeHandPan, 'hand tool still pans with left drag');
    assert.equal(await page.locator('.cvn-selection-box').isVisible(), false);
    await page.keyboard.press('v');
    assert.equal(await mode.getAttribute('data-mode'), 'pointer');
    assert.notEqual(await mode.locator('svg path').getAttribute('d'), hand);
    const stage = page.locator('.cvn-stage');
    const beforePan = await stage.getAttribute('style');
    await page.mouse.move(1450, 850); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(1490, 885, { steps: 4 });
    assert.equal(await page.locator('.middle-panning').count(), 1);
    assert.equal(await mode.getAttribute('data-mode'), 'temporary-hand');
    await page.mouse.up({ button: 'middle' });
    assert.equal(await page.locator('.middle-panning').count(), 0);
    assert.equal(await mode.getAttribute('data-mode'), 'pointer');
    assert.notEqual(await stage.getAttribute('style'), beforePan);
    assert.ok((await stage.getAttribute('style')).includes('scale(0.65)'));
    // Native mouse presses must pan even over dock controls and when another button is held.
    for (const target of [mode, page.locator('[data-id="src-v"] .cvn-node-body > video')]) {
      const box = await target.boundingBox(), before = await stage.getAttribute('style');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 20, { steps: 3 });
      assert.equal(await mode.getAttribute('data-mode'), 'temporary-hand', 'middle press uses hand over controls/media');
      await page.mouse.up({ button: 'middle' });
      assert.notEqual(await stage.getAttribute('style'), before);
      assert.equal(await mode.getAttribute('data-mode'), 'pointer');
    }
    await page.mouse.move(1450, 800); await page.mouse.down();
    const beforeChord = await stage.getAttribute('style');
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(1480, 825, { steps: 3 });
    assert.notEqual(await stage.getAttribute('style'), beforeChord, 'middle press works when left button was already held');
    await page.mouse.up({ button: 'middle' }); await page.mouse.up();
    assert.equal(await mode.getAttribute('data-mode'), 'pointer');
    const movingSource = page.locator('[data-id="src-a"]');
    await page.evaluate(() => {
      window.reviewImage = document.querySelector('[data-id="src-a"] .cvn-node-body > img');
      window.reviewVideo = document.querySelector('[data-id="src-v"] .cvn-node-body > video');
      window.reviewFlow = document.querySelector('.cvn-wire-flow');
      window.reviewFlowAnimation = window.reviewFlow.getAnimations()[0];
      window.reviewLoads = 0;
      window.reviewImage.addEventListener('load', () => window.reviewLoads++);
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const beforeX = await movingSource.evaluate(node => node.offsetLeft), sourceTitle = await movingSource.locator('.cvn-node-title').boundingBox();
      await page.mouse.move(sourceTitle.x + 12, sourceTitle.y + 5); await page.mouse.down();
      await page.mouse.move(sourceTitle.x + 38, sourceTitle.y + 18, { steps: 4 }); await page.mouse.up();
      assert.equal(await movingSource.evaluate(node => node.offsetLeft), beforeX + 40, 'successive drags use the updated position');
      assert.ok(await page.evaluate(() => window.reviewImage === document.querySelector('[data-id="src-a"] .cvn-node-body > img') && window.reviewVideo === document.querySelector('[data-id="src-v"] .cvn-node-body > video') && window.reviewLoads === 0), 'moving nodes preserves existing media elements without reloading');
      assert.ok(await page.evaluate(() => window.reviewFlow.isConnected && window.reviewFlowAnimation === window.reviewFlow.getAnimations()[0]), 'wire animation stays mounted while dragging');
    }
    await image.locator('.cvn-node-title').click();
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
    assert.equal(await page.locator('.canvas-context-menu').getByText('Đánh giá', { exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await image.locator('.cvn-node-title').click();
    await page.locator('.cvn-dock').getByLabel('Kho', { exact: true }).click();
    const library = page.locator('.image-warehouse');
    await library.locator('.character-card img').first().waitFor();
    assert.ok(await library.locator('.character-card img').first().evaluate(image => image.complete && image.naturalWidth > 0));
    assert.ok((await library.boundingBox()).width <= 780);
    assert.ok((await library.locator('.character-card').first().boundingBox()).width < 180);
    await library.locator('.character-card').filter({ hasText: 'ảnh đỏ.png' }).click();
    await library.locator('.character-card').filter({ hasText: 'ảnh xanh.png' }).click();
    assert.equal(await library.locator('.character-card[aria-pressed="true"]').count(), 2);
    await library.getByRole('button', { name: 'Chọn một', exact: true }).click();
    assert.equal(await library.locator('.character-card[aria-pressed="true"]').count(), 1);
    await library.getByRole('button', { name: 'Chọn nhiều', exact: true }).click();
    await library.getByLabel('Xem trượt', { exact: true }).click();
    assert.equal(await library.locator('.character-view-slide').count(), 1);
    await library.getByLabel('Xem lưới', { exact: true }).click();
    await library.getByLabel('Tải ảnh vào Kho', { exact: true }).setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: Buffer.from(fixture.image, 'base64') });
    await page.waitForFunction(() => document.querySelectorAll('.image-warehouse-card img').length === 3);
    await library.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByLabel('Lịch sử', { exact: true }).click();
    const history = page.locator('.project-asset-library');
    await history.locator('.project-library-card').waitFor();
    assert.equal(await history.locator('.project-library-card').count(), 1, 'history defaults to this project');
    await history.getByRole('button', { name: 'Tất cả dự án', exact: true }).click();
    assert.equal(await history.locator('.project-library-card').count(), 2);
    await history.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByLabel('Quản lý tài sản', { exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#canvas/' + fixture.id, 'asset manager stays inside the current Canvas');
    assert.equal(await page.locator('.cvn-studio').count(), 1);
    assert.equal(await page.locator('.canvas-assets-drawer').isVisible(), true);
    await page.locator('.canvas-assets-drawer').getByLabel('Thu bảng tài sản', { exact: true }).first().click();
    assert.equal(await page.locator('.canvas-assets-drawer').isVisible(), false);
    await page.getByLabel('Sắp xếp workflow', { exact: true }).click();
    const arranged = await page.locator('.cvn-node').evaluateAll(nodes => nodes.map(node => ({ x: node.offsetLeft, y: node.offsetTop, height: node.querySelector('.cvn-node-body').offsetHeight })));
    for (const x of new Set(arranged.map(node => node.x))) {
      const column = arranged.filter(node => node.x === x).sort((a, b) => a.y - b.y);
      for (let index = 1; index < column.length; index++) assert.equal(column[index].y - column[index - 1].y - column[index - 1].height, 30, 'layout gap is exactly 30px');
    }
    assert.ok((await stage.getAttribute('style')).includes('scale(0.65)'), 'UI actions and layout preserve zoom');
    const previousIds = await page.locator('.cvn-node').evaluateAll(nodes => nodes.map(node => node.dataset.id));
    await page.getByLabel('Thêm vào canvas', { exact: true }).click();
    await page.locator('.dock-add-panel').getByRole('button', { name: 'Ảnh', exact: true }).click();
    const newId = await page.locator('.cvn-node').evaluateAll((nodes, previous) => nodes.find(node => !previous.includes(node.dataset.id)).dataset.id, previousIds);
    const newPreview = await page.locator(`[data-id="${newId}"] > .cvn-node-body`).boundingBox();
    assert.ok(Math.abs(newPreview.x + newPreview.width / 2 - 800) < 2 && Math.abs(newPreview.y + newPreview.height / 2 - 525) < 2, 'new node appears at the viewport center');
    assert.ok((await stage.getAttribute('style')).includes('scale(0.65)'));
    await page.locator(`[data-id="${newId}"] .cvn-node-title`).click();
    await page.keyboard.press('Delete');
    assert.equal(await page.evaluate(() => window.reviewImage === document.querySelector('[data-id="src-a"] .cvn-node-body > img') && window.reviewVideo === document.querySelector('[data-id="src-v"] .cvn-node-body > video')), true, 'adding a node retains unrelated image/video elements');
    await page.evaluate(() => document.querySelector('.cvn-viewport').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1500, clientY: 700 })));
    await page.getByRole('menu', { name: 'Thao tác Canvas', exact: true }).getByRole('menuitem', { name: /Thêm node/ }).hover();
    const submenu = page.getByRole('menu', { name: 'Loại node', exact: true });
    await submenu.getByRole('menuitem', { name: 'Kịch bản', exact: true }).click();
    const script = page.locator('.cvn-node').filter({ has: page.getByLabel('Nội dung kịch bản', { exact: true }) });
    await script.getByLabel('Nội dung kịch bản', { exact: true }).fill('Cảnh đầu tiên\n\nCảnh thứ hai', { timeout: 5000 });
    assert.equal(await script.locator('.cvn-empty-symbol').count(), 0, 'script has a text editor rather than an image placeholder');
    const textTools = page.getByLabel('Công cụ văn bản đã chọn', { exact: true });
    await textTools.getByRole('button', { name: 'Sửa văn bản', exact: true }).click();
    assert.equal(await script.getByLabel('Nội dung kịch bản', { exact: true }).evaluate(node => node === document.activeElement), true);
    const textDownload = page.waitForEvent('download');
    await textTools.getByRole('button', { name: 'Tải .txt', exact: true }).click();
    const downloadedText = await textDownload;
    assert.ok(downloadedText.suggestedFilename().endsWith('.txt'));
    assert.equal(await readFile(await downloadedText.path(), 'utf8'), 'Cảnh đầu tiên\n\nCảnh thứ hai');
    await textTools.getByRole('button', { name: 'Sao chép', exact: true }).click();
    await textTools.getByRole('button', { name: 'Tách văn bản', exact: true }).click();
    await page.getByRole('button', { name: 'Tạo node từ các đoạn', exact: true }).click();
    assert.equal(await page.getByLabel('Nội dung prompt', { exact: true }).count(), 2, 'splitting produces two text nodes');
    const scriptId = await script.getAttribute('data-id');
    await page.locator(`[data-id="${scriptId}"] .cvn-node-title`).click();
    await textTools.getByRole('button', { name: 'Nhân bản', exact: true }).click();
    assert.equal(await page.getByLabel('Nội dung kịch bản', { exact: true }).count(), 2);
    await page.keyboard.press('Delete');
    assert.equal(await page.getByLabel('Nội dung kịch bản', { exact: true }).count(), 1);
    for (let visit = 0; visit < 3; visit++) {
      await page.evaluate(() => { location.hash = '#settings'; });
      await page.getByLabel('Dịch vụ trợ lý AI', { exact: true }).waitFor();
      await page.evaluate(id => { location.hash = '#canvas/' + id; }, fixture.id);
      await page.locator('.cvn-node[data-id="image-target"]').waitFor();
      await page.getByLabel('Quản lý tài sản', { exact: true }).click();
      assert.equal(await page.locator('.canvas-assets-drawer').isVisible(), true);
      await page.getByLabel('Quản lý tài sản', { exact: true }).click();
      assert.equal(new URL(page.url()).hash, '#canvas/' + fixture.id);
      assert.ok((await page.locator('.cvn-stage').getAttribute('style')).includes('scale(0.65)'), 'rapid reopen keeps saved zoom');
      assert.equal(await page.getByText(/Dự án đã thay đổi ở tab khác/).count(), 0, 'opening metadata never conflicts with the previous save');
    }
    await page.goto(url + '/#settings');
    await page.getByLabel('Dịch vụ trợ lý AI', { exact: true }).selectOption('grok');
    await page.getByRole('button', { name: 'Cập nhật tab trợ lý', exact: true }).click();
    await page.getByLabel('Tab dành riêng cho trợ lý AI', { exact: true }).selectOption('8');
    await page.getByRole('button', { name: 'Dành tab này cho trợ lý', exact: true }).click();
    assert.equal(assistant.tabId, 8);
    await page.goto(url + '/#canvas/' + fixture.id);
    const videoNode = page.locator('[data-id="video-target"]');
    await videoNode.locator('.cvn-node-title').click();
    await videoNode.getByLabel('AI thực hiện', { exact: true }).selectOption('grok');
    assert.equal(await videoNode.locator('[aria-label="AI thực hiện"] option[value="chatgpt"]').count(), 0, 'unconnected AI is hidden');
    await videoNode.locator('.inline-connection summary').click();
    await page.waitForFunction(() => document.querySelector('[data-id="video-target"] [aria-label="Tab chạy luồng"] option[value="9"]'));
    assert.equal(await videoNode.locator('[aria-label="Tab chạy luồng"] option[value="8"]').count(), 0, 'reserved tab is excluded from workflow choices');
    await videoNode.locator('.inline-connection').evaluate(menu => { menu.open = true; });
    await videoNode.getByLabel('Tab chạy luồng', { exact: true }).selectOption('9');
    assert.match(await videoNode.locator('[aria-label="Tab chạy luồng"] option:checked').textContent(), /1 node · Tab làm việc kiểm chứng · Sẵn sàng/);
    await image.locator('.cvn-node-title').click();
    await image.getByLabel('AI thực hiện', { exact: true }).selectOption('grok');
    await image.getByLabel('Tab chạy luồng', { exact: true }).selectOption('9');
    assert.match(await image.locator('[aria-label="Tab chạy luồng"] option:checked').textContent(), /2 node · Tab làm việc kiểm chứng · Sẵn sàng/);
    await page.evaluate(async id => {
      const { write } = await import('./core/storage.js');
      await write('jobs', { id: 'tab-status-check', projectId: id, status: 'sent', tabId: 9 });
    }, fixture.id);
    await page.waitForFunction(() => document.querySelector('[data-id="image-target"] [aria-label="Tab chạy luồng"] option:checked')?.textContent.includes('Đang xử lý'));
    await page.evaluate(async () => { const { remove } = await import('./core/storage.js'); await remove('jobs', 'tab-status-check'); });
    await page.waitForFunction(() => document.querySelector('[data-id="image-target"] [aria-label="Tab chạy luồng"] option:checked')?.textContent.includes('Sẵn sàng'));
    await image.locator('.inline-connection').evaluate(menu => { menu.open = false; });
    const rejected = await page.evaluate(async () => {
      const { api } = await import('./client-api.js');
      try { await api('jobs', { provider: 'grok', tabId: 8, prompt: 'blocked' }); return ''; }
      catch (error) { return error.message; }
    });
    assert.ok(rejected.includes('dành riêng'));
    assert.equal(workflowRequests, 0, 'reserved tab is rejected before a workflow request');
    await page.getByLabel('Trợ lý sáng tạo', { exact: true }).click();
    await page.getByLabel('Tin nhắn cho trợ lý AI', { exact: true }).fill('Hãy giúp tôi xây dựng ý tưởng.');
    await page.getByRole('button', { name: 'Gửi cho trợ lý', exact: true }).click();
    await page.getByText('Đã nhận yêu cầu trên tab trợ lý.', { exact: true }).waitFor();
    assert.equal(assistantRequests, 1);
    await page.locator('.cvn-resource-sheet').getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.goto(url + '/#settings');
    await page.getByRole('button', { name: 'Bỏ tab trợ lý', exact: true }).click();
    const released = await page.evaluate(async () => { const { api } = await import('./client-api.js'); return api('tabs?provider=grok'); });
    assert.deepEqual(released.map(tab => tab.id), [8, 9]);
    const inputId = await page.evaluate(async () => {
      const { list, write } = await import('./core/storage.js');
      const { emptyGraph } = await import('./core/graph.js');
      const graph = emptyGraph();
      graph.nodes.push({ id: 'template-image', type: 'generateImage', x: 0, y: 0, data: { size: '16:9', studioPrompt: 'Mẫu cũ' } });
      await write('templates', { id: 'batch-template', name: 'Mẫu kiểm chứng', graph });
      return (await list('inputs')).find(asset => asset.kind === 'image').id;
    });
    const batchRequests = [];
    await page.route('**/api/jobs', async route => {
      const body = route.request().postDataJSON(); batchRequests.push(body);
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ json: { status: 'success', result: { kind: body.mediaType, url: body.mediaType === 'video' ? video : 'data:image/png;base64,' + fixture.image } } });
    });
    await page.goto(url + '/#images');
    const lane1 = page.getByRole('form', { name: 'Khu làm việc 1', exact: true }), lane2 = page.getByRole('form', { name: 'Khu làm việc 2', exact: true });
    await lane1.waitFor(); await lane2.waitFor();
    assert.equal(await page.locator('.batch-workspace > *').count(), 3, 'two workspaces and a shared queue');
    assert.equal(await page.locator('.batch-groups > button').count(), 7);
    await page.locator('.batch-groups').getByRole('button', { name: 'Văn bản', exact: true }).click();
    assert.equal(await lane1.locator('.batch-source-field').isVisible(), false);
    await page.locator('.batch-groups').getByRole('button', { name: 'Ảnh sản phẩm', exact: true }).click();
    await lane1.getByLabel('AI hàng loạt', { exact: true }).selectOption('openai');
    assert.equal(await lane1.getByLabel('Tab hàng loạt', { exact: true }).isDisabled(), true, 'API provider needs no tab');
    await lane1.getByLabel('Chọn ảnh đầu vào', { exact: true }).click();
    await lane1.locator('[data-asset-id="' + inputId + '"]').click();
    assert.equal(await lane1.locator('.batch-image-picker > button > img').count(), 1, 'input is selected through an image thumbnail');
    await lane1.getByLabel('Luồng mẫu', { exact: true }).selectOption('batch-template');
    await lane1.getByLabel('Thông số hàng loạt', { exact: true }).click();
    assert.equal(await lane1.locator('.generation-options-panel .ratio-grid > button').count(), 13);
    await lane1.getByRole('button', { name: 'Khung 9:16', exact: true }).click();
    await lane1.getByLabel('Đóng thông số hàng loạt', { exact: true }).click();
    await lane1.getByLabel('Prompt hàng loạt', { exact: true }).fill('Khu một A\nKhu một B');
    await lane2.getByLabel('Prompt hàng loạt', { exact: true }).fill('Khu hai C');
    await lane2.getByLabel('AI hàng loạt', { exact: true }).selectOption('grok');
    await lane2.getByRole('button', { name: 'Cập nhật tab', exact: true }).click();
    await lane2.getByRole('button', { name: 'Xếp tác vụ vào hàng đợi', exact: true }).click();
    await page.getByText('Chọn tab đang kết nối trước khi xếp tác vụ.', { exact: true }).waitFor();
    assert.equal(batchRequests.length, 0, 'missing tab never sends a job');
    await lane2.getByLabel('Tab hàng loạt', { exact: true }).selectOption('9');
    await lane2.getByRole('button', { name: 'Cập nhật tab', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Khu làm việc 2"] [aria-label="Tab hàng loạt"]').value === '9');
    await lane2.getByLabel('Thông số hàng loạt', { exact: true }).click();
    await lane2.getByRole('button', { name: 'Khung 1:1', exact: true }).click();
    await lane2.getByLabel('Đóng thông số hàng loạt', { exact: true }).click();
    await lane1.getByRole('button', { name: 'Xếp tác vụ vào hàng đợi', exact: true }).click();
    assert.equal(await lane2.getByLabel('Prompt hàng loạt', { exact: true }).inputValue(), 'Khu hai C', 'lane one never clears lane two');
    await lane2.getByRole('button', { name: 'Xếp tác vụ vào hàng đợi', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.batch-queue .job-state.success').length === 3);
    assert.equal(batchRequests.length, 3);
    for (const request of batchRequests.filter(request => request.prompt.includes('Khu một'))) {
      assert.equal(request.provider, 'openai'); assert.equal(request.size, '9:16'); assert.equal(request.referenceImages.length, 1);
    }
    const secondRequest = batchRequests.find(request => request.prompt.includes('Khu hai'));
    assert.equal(secondRequest.provider, 'grok'); assert.equal(secondRequest.tabId, 9); assert.equal(secondRequest.size, '1:1');
    assert.ok((await page.locator('.batch-queue-stats').textContent()).includes('3 hoàn tất'));
    await lane1.getByLabel('Thông số hàng loạt', { exact: true }).click();
    await lane1.getByRole('group', { name: 'Số lượng ảnh', exact: true }).getByRole('button', { name: '2 ảnh', exact: true }).click();
    await lane1.getByRole('group', { name: 'Chất lượng', exact: true }).getByRole('button', { name: 'Cao', exact: true }).click();
    await lane1.getByLabel('Đóng thông số hàng loạt', { exact: true }).click();
    await lane1.getByLabel('Prompt hàng loạt', { exact: true }).fill('Hai biến thể');
    await lane1.getByRole('button', { name: 'Xếp tác vụ vào hàng đợi', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.batch-queue .job-state.success').length === 5);
    assert.equal(batchRequests.filter(request => request.prompt.includes('Hai biến thể')).length, 2, 'image count creates two distinct real requests');
    assert.ok(batchRequests.filter(request => request.prompt.includes('Hai biến thể')).every(request => request.quality === 'high'));
    await page.goto(url + '/#videos');
    await lane1.getByLabel('AI hàng loạt', { exact: true }).selectOption('grok');
    await lane1.getByRole('button', { name: 'Cập nhật tab', exact: true }).click();
    await lane1.getByLabel('Tab hàng loạt', { exact: true }).selectOption('9');
    await lane1.getByLabel('Thời lượng video', { exact: true }).selectOption('10');
    await lane1.getByLabel('Thông số hàng loạt', { exact: true }).click();
    assert.equal(await lane1.locator('.generation-options-panel .ratio-grid > button').count(), 13);
    await lane1.getByRole('button', { name: 'Khung 9:16', exact: true }).click();
    await lane1.getByLabel('Đóng thông số hàng loạt', { exact: true }).click();
    await lane1.getByLabel('Prompt hàng loạt', { exact: true }).fill('Video kiểm chứng');
    await lane1.getByRole('button', { name: 'Xếp tác vụ vào hàng đợi', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.batch-queue .job-state.success').length === 1);
    assert.equal(batchRequests.at(-1).duration, 10); assert.equal(batchRequests.at(-1).mediaType, 'video');
    assert.deepEqual(errors, []);
    if (process.env.REVIEW_DIR) { await mkdir(process.env.REVIEW_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.REVIEW_DIR, 'canvas-review.png') }); }
    console.log('PASS built static app: stable media DOM, visual references, popup layering, middle-pan, hover submenu, script edit/split/download/duplicate, two batch workspaces with thumbnail inputs and real queue states, connected AI choices and shared-tab counts, exclusive assistant settings/chat. No live AI.');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
