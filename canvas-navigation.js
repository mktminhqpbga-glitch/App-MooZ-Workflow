import { el, button, notice } from './client-api.js';
import { icon } from './icons.js';
import { list, addAsset } from './core/storage.js';

export function createCanvasNavigation({ shell, hud, zoomNode, projectId, getName, getGraph, getRects, onSelectNode, onCenter, onLayout, onOpenLibrary, onUseAsset, onUsePrompt, onUseTemplate, signal }) {
  let open = false, activeTab = 'assets', category = 'inputs', search = '', reverse = false, request = 0, contentKey = '';
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('mooz-canvas-tools') || '{}'); } catch {}
  let snap = Boolean(prefs.snap), minimapVisible = Boolean(prefs.minimap), wiresHidden = Boolean(prefs.wiresHidden);
  let categories = localStorage.getItem('mooz-canvas-categories') === '1';
  const urls = new Map();
  const savePrefs = () => {
    try { localStorage.setItem('mooz-canvas-tools', JSON.stringify({ snap, minimap: minimapVisible, wiresHidden })); } catch {}
  };
  const controls = [...hud.children].filter(node => node !== zoomNode);
  const zoomMenu = el('details', undefined, 'canvas-zoom-menu'), zoomSummary = el('summary'), zoomControls = el('div');
  zoomSummary.append(zoomNode);
  zoomSummary.setAttribute('aria-label', 'Điều chỉnh mức thu phóng');
  zoomControls.append(...controls);
  zoomControls.addEventListener('click', event => { if(event.target.closest('button')?.textContent.includes('Vừa khung')) zoomMenu.open=false; });
  document.addEventListener('pointerdown', event => { if(!zoomMenu.contains(event.target)) zoomMenu.open=false; }, { capture:true, signal });
  zoomMenu.append(zoomSummary, zoomControls);
  const tool = (label, name, action) => {
    const control = button('', action);
    control.append(icon(name));
    control.title = label;
    control.setAttribute('aria-label', label);
    return control;
  };
  const assetsButton = tool('Quản lý tài sản', 'sidebar', () => setOpen(!open));
  assetsButton.append(el('span', 'Quản lý tài sản'));
  const layoutButton = tool('Sắp xếp workflow', 'layout', onLayout),
    mapButton = tool('Bản đồ thu nhỏ Canvas', 'pin', () => { minimapVisible = !minimapVisible; updateTools(); savePrefs(); }),
    wiresButton = tool('Ẩn dây nối', 'connections', () => { wiresHidden = !wiresHidden; updateTools(); savePrefs(); }),
    snapButton = tool('Hút lưới', 'magnet', () => { snap = !snap; updateTools(); savePrefs(); });
  hud.replaceChildren(assetsButton, layoutButton, mapButton, wiresButton, snapButton, zoomMenu);
  hud.classList.add('canvas-navigation');
  const drawer = el('aside', undefined, 'canvas-assets-drawer');
  drawer.hidden = true;
  drawer.setAttribute('aria-label', 'Quản lý Canvas và tài sản');
  const heading = el('div', undefined, 'canvas-assets-heading'), title = el('strong'),
    close = tool('Thu bảng tài sản', 'collapse', () => setOpen(false));
  heading.append(el('span', 'M', 'drawer-brand'), close);
  const projectLine = el('div', undefined, 'canvas-assets-project');
  projectLine.append(title, el('span', 'Canvas 1'));
  const tabs = el('div', undefined, 'canvas-assets-tabs'), body = el('div', undefined, 'canvas-assets-content'),
    footer = el('div', undefined, 'canvas-assets-footer'), count = el('span');
  tabs.setAttribute('role', 'tablist');
  for (const [id, text] of [['canvas', 'Canvas'], ['assets', 'Tài sản']]) {
    const control = button(text, () => { activeTab = id; refresh(); });
    control.setAttribute('role', 'tab');
    control.dataset.tab = id;
    tabs.append(control);
  }
  const bar = el('div', undefined, 'canvas-assets-bar'), filter = el('input'), categorySelect = el('select');
  filter.type = 'search'; filter.placeholder = 'Tìm kiếm…'; filter.setAttribute('aria-label', 'Tìm trong bảng tài sản');
  filter.oninput = () => { search = filter.value.toLocaleLowerCase('vi'); void renderContent(); };
  for (const [value, name] of [['inputs', 'Đầu vào'], ['results', 'Kết quả'], ['prompts', 'Prompt'], ['templates', 'Luồng']]) categorySelect.add(new Option(name, value));
  categorySelect.setAttribute('aria-label', 'Loại tài sản');
  categorySelect.onchange = () => { category = categorySelect.value; void renderContent(); };
  const upload = el('input');
  upload.type = 'file'; upload.multiple = true; upload.accept = 'image/*,video/*,audio/*'; upload.hidden = true;
  upload.onchange = async () => {
    try {
      for (const file of upload.files) await addAsset(file, { projectId });
      upload.value = '';
      category = 'inputs'; categorySelect.value = category;
      activeTab = 'assets'; refresh();
      notice('Đã tải tài sản vào Kho Đầu vào.');
    } catch (error) { notice(error.message); }
  };
  const add = tool('Tải tài sản lên', 'upload', () => upload.click()),
    sort = tool('Đảo thứ tự danh sách', 'sort', () => { reverse = !reverse; sort.setAttribute('aria-pressed', String(reverse)); void renderContent(); }),
    manage = tool('Mở Kho quản lý', 'folder', onOpenLibrary);
  manage.append(el('span', 'Quản lý'));
  bar.append(filter, sort, add, manage);
  footer.append(tool('Thu bảng tài sản', 'collapse', () => setOpen(false)), count);
  drawer.append(heading, projectLine, tabs, bar, categorySelect, body, footer, upload);
  const minimap = el('div', undefined, 'canvas-minimap');
  minimap.setAttribute('aria-label', 'Bản đồ thu nhỏ Canvas');
  shell.append(drawer, minimap);
  function setOpen(value) {
    open = value;
    drawer.hidden = !open;
    shell.classList.toggle('asset-drawer-open', open);
    assetsButton.setAttribute('aria-expanded', String(open));
    if (open) refresh();
  }
  function updateTools() {
    mapButton.setAttribute('aria-pressed', String(minimapVisible));
    wiresButton.setAttribute('aria-pressed', String(wiresHidden));
    snapButton.setAttribute('aria-pressed', String(snap));
    shell.classList.toggle('canvas-wires-hidden', wiresHidden);
    minimap.hidden = !minimapVisible;
    refreshMinimap();
  }
  async function renderContent() {
    const version = ++request;
    try {
      let items = activeTab === 'canvas' ? getGraph().nodes : await list(category);
      if (version !== request || !open || signal.aborted) return;
      items = items.filter(item => (item.name || item.data?.customName || item.type || '').toLocaleLowerCase('vi').includes(search));
      if (activeTab === 'assets') items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      if (reverse) items.reverse();
      const nextKey = JSON.stringify([activeTab, category, search, reverse, categories, items.map(item => [item.id, item.name, item.data?.customName, item.type, item.kind, item.updatedAt, item.blob?.size])]);
      if (nextKey === contentKey && body.children.length) return;
      contentKey = nextKey;
      body.replaceChildren();
      if (!items.length) {
        const empty = el('div', undefined, 'canvas-assets-empty');
        empty.append(icon('folder'), el('p', activeTab === 'canvas' ? 'Chưa có node trên Canvas.' : 'Chưa có tài sản trong mục này.'));
        if (activeTab === 'assets') {
          if (!categories) empty.append(button('Tạo danh mục mặc định', () => {
            categories = true;
            try { localStorage.setItem('mooz-canvas-categories', '1'); } catch {}
            refresh();
          }));
          empty.append(button('Tải tài sản lên', () => upload.click()));
        }
        body.append(empty); return;
      }
      for (const item of items) {
        const row = button('', async () => {
          if (activeTab === 'canvas') onSelectNode(item.id);
          else if (category === 'prompts') await onUsePrompt(item);
          else if (category === 'templates') await onUseTemplate(item);
          else await onUseAsset(item);
        }, 'canvas-asset-row');
        if (item.kind === 'image' && item.blob) {
          let url = urls.get(item.id);
          if (!url) { url = URL.createObjectURL(item.blob); urls.set(item.id, url); }
          const image = el('img'); image.src = url; image.alt = ''; row.append(image);
        } else row.append(icon(item.kind === 'audio' ? 'music' : item.kind === 'video' ? 'video' : activeTab === 'canvas' ? 'layout' : category === 'templates' ? 'connections' : 'text'));
        const label = el('span', undefined, 'canvas-asset-row-label');
        label.append(el('strong', item.name || item.data?.customName || item.type), el('small', activeTab === 'canvas' ? item.type : item.kind || (category === 'prompts' ? 'Prompt' : 'Luồng')));
        row.append(label); body.append(row);
      }
    } catch (error) {
      if (version === request && open) body.replaceChildren(el('p', error.message));
    }
  }
  function refresh() {
    title.textContent = getName();
    count.textContent = getGraph().nodes.length + ' node';
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.tab === activeTab));
    categorySelect.hidden = activeTab !== 'assets' || !categories;
    if (open) void renderContent();
    refreshMinimap();
  }
  function refreshMinimap() {
    if (!minimapVisible || signal.aborted) return;
    const nodes = getRects();
    minimap.replaceChildren();
    const title = el('div', undefined, 'canvas-minimap-heading');
    title.append(el('span', 'Canvas'), tool('Đóng bản đồ', 'close', () => { minimapVisible = false; updateTools(); savePrefs(); }));
    minimap.append(title);
    if (!nodes.length) { minimap.append(el('p', 'Canvas trống')); return; }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const x = Math.min(...nodes.map(node => node.x)) - 60, y = Math.min(...nodes.map(node => node.y)) - 60,
      width = Math.max(...nodes.map(node => node.x + node.width)) - x + 60,
      height = Math.max(...nodes.map(node => node.y + node.height)) - y + 60;
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    for (const edge of getGraph().edges) {
      const a = nodes.find(node => node.id === edge.source), b = nodes.find(node => node.id === edge.target);
      if (!a || !b) continue;
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', `M${a.x + a.width} ${a.y + a.height / 2} L${b.x} ${b.y + b.height / 2}`);
      svg.append(path);
    }
    for (const node of nodes) {
      const rect = document.createElementNS(svg.namespaceURI, 'rect');
      for (const [name, value] of Object.entries({ x: node.x, y: node.y, width: node.width, height: node.height, rx: 10 })) rect.setAttribute(name, value);
      rect.setAttribute('tabindex', '0'); rect.setAttribute('role', 'button'); rect.setAttribute('aria-label', node.name || 'Đến node');
      rect.onclick = () => { onCenter(node.x + node.width / 2, node.y + node.height / 2, open ? drawer.offsetWidth : 0); };
      rect.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); rect.onclick(); } };
      svg.append(rect);
    }
    minimap.append(svg);
  }
  signal.addEventListener('abort', () => { request++; for (const url of urls.values()) URL.revokeObjectURL(url); }, { once: true });
  updateTools();
  assetsButton.setAttribute('aria-expanded', 'false');
  return { refresh, refreshMinimap, get snapEnabled() { return snap; }, get drawerWidth() { return open ? drawer.offsetWidth : 0; } };
}
