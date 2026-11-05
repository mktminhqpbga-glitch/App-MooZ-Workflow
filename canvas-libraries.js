import { el, button, notice } from './client-api.js';
import { icon } from './icons.js';
import { list, readAsset, write, remove, addAsset } from './core/storage.js';

function libraryShell(className, title, signal) {
  const dialog = el('dialog', undefined, 'canvas-library ' + className),
    header = el('div', undefined, 'canvas-library-header'), close = button('', () => dialog.close()), urls = new Map();
  close.append(icon('close')); close.setAttribute('aria-label', 'Đóng');
  header.append(el('h2', title), close); dialog.append(header);
  document.body.append(dialog);
  const urlFor = asset => {
    if (!urls.has(asset.id)) urls.set(asset.id, URL.createObjectURL(asset.blob));
    return urls.get(asset.id);
  };
  dialog.addEventListener('close', () => { for (const url of urls.values()) URL.revokeObjectURL(url); dialog.remove(); }, { once: true });
  signal?.addEventListener('abort', () => { dialog.close(); dialog.remove(); }, { once: true });
  dialog.showModal();
  return { dialog, header, urlFor };
}

export async function openCharacterLibrary({ projectId, signal, canReference, onReference, onAdd }) {
  const { dialog, urlFor } = libraryShell('character-library image-warehouse', 'Kho', signal),
    toolbar = el('div', undefined, 'image-warehouse-toolbar'), tabs = el('div', undefined, 'image-warehouse-tabs'),
    search = el('input'), selectionModes = el('div', undefined, 'image-warehouse-selection'),
    views = el('div', undefined, 'character-view-switch'), gallery = el('div', undefined, 'character-gallery'),
    footer = el('div', undefined, 'character-library-footer'), count = el('span', '', 'image-warehouse-count'), upload = el('input');
  let assets = [], category = 'inputs', mode = 'grid', multiple = true, selected = new Set();
  search.type = 'search'; search.placeholder = 'Tìm ảnh trong Kho…'; search.setAttribute('aria-label', 'Tìm ảnh trong Kho'); search.oninput = render;
  upload.type = 'file'; upload.accept = 'image/*'; upload.multiple = true; upload.hidden = true; upload.setAttribute('aria-label', 'Tải ảnh vào Kho');
  const tabButtons = [];
  for (const [value, name] of [['inputs', 'Đầu vào'], ['results', 'Kết quả']]) {
    const control = button(name, () => { category = value; void load(); });
    control.dataset.category = value; tabs.append(control); tabButtons.push(control);
  }
  for (const [value, label, glyph] of [['slide', 'Xem trượt', 'panorama'], ['grid', 'Xem lưới', 'layout']]) {
    const control = button('', () => { mode = value; render(); });
    control.append(icon(glyph)); control.dataset.mode = value; control.title = label; control.setAttribute('aria-label', label); views.append(control);
  }
  for (const [value, label] of [[false, 'Chọn một'], [true, 'Chọn nhiều']]) {
    const control = button(label, () => { multiple = value; if (!multiple && selected.size > 1) selected = new Set([[...selected][0]]); render(); });
    control.dataset.multiple = String(value); selectionModes.append(control);
  }
  toolbar.append(search, selectionModes, views);
  const uploadButton = button('＋ Tải ảnh', () => upload.click()), add = button('Thêm vào Canvas', async () => {
    const picked = await selectedAssets();
    for (const asset of picked) await onAdd(asset);
    if (picked.length) dialog.close();
  }), reference = button('Dùng làm tham chiếu', async () => {
    const picked = await selectedAssets();
    for (const asset of picked) await onReference({ name: asset.name, assetId: asset.id });
    if (picked.length) dialog.close();
  }), clear = button('Bỏ chọn', () => { selected.clear(); render(); });
  footer.append(uploadButton, count, clear, add, reference);
  dialog.append(tabs, toolbar, gallery, footer, upload);
  async function selectedAssets() {
    const items = [];
    for (const id of selected) {
      const asset = await readAsset(id);
      if (!asset || asset.kind !== 'image') throw Error('Một ảnh đã bị xóa khỏi Kho. Hãy chọn lại.');
      items.push(asset);
    }
    return items;
  }
  async function load() {
    try {
      const value = category;
      const items = await list(value);
      if (!dialog.isConnected || value !== category) return;
      assets = items.filter(asset => asset.kind === 'image');
      render();
    } catch (error) { notice(error.message); }
  }
  upload.onchange = async () => {
    uploadButton.disabled = true;
    try {
      const added = [];
      for (const file of upload.files) added.push(await addAsset(file, { projectId }));
      if (added.length) selected = multiple ? new Set([...selected, ...added.map(asset => asset.id)]) : new Set([added[0].id]);
      upload.value = ''; category = 'inputs'; await load();
    } catch (error) { notice(error.message); }
    finally { uploadButton.disabled = false; }
  };
  function render() {
    gallery.className = 'character-gallery character-view-' + mode;
    gallery.replaceChildren();
    for (const control of tabButtons) control.setAttribute('aria-pressed', String(control.dataset.category === category));
    for (const control of views.children) control.setAttribute('aria-pressed', String(control.dataset.mode === mode));
    for (const control of selectionModes.children) control.setAttribute('aria-pressed', String(control.dataset.multiple === String(multiple)));
    const visible = assets.filter(asset => asset.name.toLocaleLowerCase('vi').includes(search.value.toLocaleLowerCase('vi')));
    if (!visible.length) gallery.append(el('p', 'Chưa có ảnh phù hợp trong mục này.', 'library-empty-state'));
    for (const asset of visible) {
      const chosen = selected.has(asset.id);
      const card = button('', () => {
        if (multiple) { if (selected.has(asset.id)) selected.delete(asset.id); else selected.add(asset.id); }
        else selected = selected.has(asset.id) ? new Set() : new Set([asset.id]);
        render();
      }, 'character-card image-warehouse-card');
      card.classList.toggle('selected', chosen); card.setAttribute('aria-pressed', String(chosen)); card.title = asset.name;
      const preview = el('div', undefined, 'character-card-preview'), image = el('img');
      image.alt = asset.name; image.draggable = false;
      image.onerror = () => preview.replaceChildren(el('span', 'Không đọc được ảnh', 'character-preview-message'));
      image.src = urlFor(asset); preview.append(image);
      card.append(preview, el('strong', asset.name), el('span', chosen ? '✓' : '', 'warehouse-selection-check')); gallery.append(card);
    }
    count.textContent = 'Đã chọn ' + selected.size + ' ảnh';
    clear.disabled = add.disabled = selected.size === 0;
    reference.disabled = selected.size === 0 || !canReference;
    reference.title = canReference ? 'Dùng các ảnh đã chọn làm tham chiếu' : 'Chọn node tạo ảnh/video trước khi mở Kho';
  }
  await load();
}

export async function openProjectAssetLibrary({ projectId, signal, onAdd, initialCategory = 'history' }) {
  const { dialog, header, urlFor } = libraryShell('project-asset-library', 'Kho sản phẩm', signal),
    sidebar = el('nav', undefined, 'project-library-sidebar'), main = el('div', undefined, 'project-library-main'),
    scopes = el('div', undefined, 'project-library-scopes'), filters = el('div', undefined, 'project-library-filters'),
    gallery = el('div', undefined, 'project-library-gallery'), footer = el('div', undefined, 'project-library-footer');
  let category = initialCategory, scope = 'project', kind = 'all', selected = null, inputs = [], results = [];
  const scopeButtons = [], categoryButtons = [];
  for (const [value, name] of [['history', 'Lịch sử tạo'], ['saved', 'Đã lưu'], ['uploads', 'Đã tải lên']]) {
    const control = button(name, () => { category = value; selected = null; render(); }); control.dataset.category = value; sidebar.append(control); categoryButtons.push(control);
  }
  for (const [value, name] of [['project', 'Dự án này'], ['all', 'Tất cả dự án']]) {
    const control = button(name, () => { scope = value; selected = null; render(); }); control.dataset.scope = value; scopes.append(control); scopeButtons.push(control);
  }
  const add = button('Thêm vào Canvas', async () => { if (selected) { await onAdd(selected); dialog.close(); } }),
    download = button('Tải xuống', () => {
      if (!selected) return;
      const link = el('a'); link.href = urlFor(selected); link.download = selected.name; link.click();
    });
  footer.append(add, download); main.append(scopes, filters, gallery, footer);
  const layout = el('div', undefined, 'project-library-layout'); layout.append(sidebar, main); dialog.append(layout);
  function render() {
    let items = category === 'uploads' ? inputs : category === 'saved' ? [...inputs, ...results].filter(asset => asset.savedAt) : results;
    if (scope === 'project') items = items.filter(asset => asset.projectId === projectId || category === 'saved' && asset.savedProjectIds?.includes(projectId));
    items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    for (const control of categoryButtons) control.setAttribute('aria-pressed', String(control.dataset.category === category));
    for (const control of scopeButtons) control.setAttribute('aria-pressed', String(control.dataset.scope === scope));
    filters.replaceChildren();
    for (const [value, name] of [['all', 'Tất cả'], ['image', 'Ảnh'], ['video', 'Video'], ['audio', 'Âm thanh']]) {
      const count = items.filter(asset => value === 'all' || asset.kind === value).length;
      const control = button(name + ' ' + count, () => { kind = value; selected = null; render(); });
      control.setAttribute('aria-pressed', String(kind === value)); filters.append(control);
    }
    const visible = items.filter(asset => kind === 'all' || asset.kind === kind);
    gallery.replaceChildren();
    if (!visible.length) gallery.append(el('p', 'Chưa có sản phẩm trong mục này.', 'library-empty-state'));
    let date = '';
    for (const asset of visible) {
      const day = new Date(asset.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      if (day !== date) { gallery.append(el('h3', day, 'project-library-date')); date = day; }
      const card = button('', () => { selected = asset; render(); }, 'project-library-card');
      card.setAttribute('aria-pressed', String(selected?.id === asset.id));
      const preview = el(asset.kind === 'image' ? 'img' : asset.kind === 'video' ? 'video' : 'span');
      if (asset.kind === 'image' || asset.kind === 'video') { preview.src = urlFor(asset); preview.draggable = false; if (asset.kind === 'video') { preview.muted = true; preview.preload = 'metadata'; } else preview.alt = asset.name; }
      else preview.append(icon('music'));
      card.append(preview, el('span', asset.name)); gallery.append(card);
    }
    add.disabled = !selected || selected.kind === 'audio';
    add.title = selected?.kind === 'audio' ? 'Canvas chưa hỗ trợ node âm thanh.' : 'Thêm tài sản vào Canvas';
    download.disabled = !selected;
  }
  try {
    [inputs, results] = await Promise.all([list('inputs'), list('results')]);
    if (dialog.isConnected) render();
  } catch (error) { notice(error.message); }
}
