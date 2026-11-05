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
  const { dialog, header, urlFor } = libraryShell('character-library', 'Nhân vật của tôi', signal),
    toolbar = el('div', undefined, 'character-library-toolbar'), filters = el('div', undefined, 'character-library-filters'),
    search = el('input'), gender = el('select'), age = el('select'), region = el('select'),
    views = el('div', undefined, 'character-view-switch'), gallery = el('div', undefined, 'character-gallery'),
    footer = el('div', undefined, 'character-library-footer');
  let people = [], selected = null, mode = 'slide';
  search.type = 'search'; search.placeholder = 'Tìm nhân vật…'; search.setAttribute('aria-label', 'Tìm nhân vật');
  for (const [select, label] of [[gender, 'Giới tính'], [age, 'Nhóm tuổi'], [region, 'Khu vực']]) {
    select.setAttribute('aria-label', label); select.add(new Option(label, '')); select.onchange = render;
  }
  search.oninput = render;
  filters.append(gender, age, region, search);
  for (const [value, label, glyph] of [['slide', 'Xem trượt', 'panorama'], ['grid', 'Xem lưới', 'layout']]) {
    const control = button('', () => { mode = value; render(); });
    control.append(icon(glyph)); control.dataset.mode = value; control.title = label; control.setAttribute('aria-label', label); views.append(control);
  }
  toolbar.append(filters, views);
  const create = button('＋ Tạo nhân vật mới', () => editPerson()), add = button('Thêm vào Canvas', async () => {
    const asset = selected && await readAsset(selected.assetId);
    if (!asset) throw Error('Chọn nhân vật có ảnh trước.');
    await onAdd(asset); dialog.close();
  }), reference = button('Dùng làm tham chiếu', async () => {
    if (!selected) return;
    await onReference(selected); dialog.close();
  }), edit = button('Chỉnh sửa nhân vật', () => editPerson(selected));
  footer.append(create, add, reference, edit);
  dialog.append(toolbar, gallery, footer);
  async function load() {
    people = await list('characters');
    if (!dialog.isConnected) return;
    for (const [select, field, label] of [[gender, 'gender', 'Giới tính'], [age, 'ageGroup', 'Nhóm tuổi'], [region, 'region', 'Khu vực']]) {
      const value = select.value;
      select.replaceChildren(new Option(label, ''));
      for (const option of [...new Set(people.map(person => person[field]).filter(Boolean))]) select.add(new Option(option, option));
      select.value = [...select.options].some(option => option.value === value) ? value : '';
    }
    if (selected) selected = people.find(person => person.id === selected.id) || null;
    render();
  }
  function render() {
    gallery.className = 'character-gallery character-view-' + mode;
    gallery.replaceChildren();
    for (const control of views.children) control.setAttribute('aria-pressed', String(control.dataset.mode === mode));
    const items = people.filter(person => (!gender.value || person.gender === gender.value) && (!age.value || person.ageGroup === age.value) && (!region.value || person.region === region.value) && (person.name || '').toLocaleLowerCase('vi').includes(search.value.toLocaleLowerCase('vi')));
    if (!items.length) gallery.append(el('p', 'Chưa có nhân vật phù hợp. Tạo nhân vật từ ảnh của bạn.', 'library-empty-state'));
    for (const person of items) {
      const card = button('', () => { selected = person; render(); }, 'character-card');
      card.classList.toggle('selected', selected?.id === person.id);
      card.setAttribute('aria-pressed', String(selected?.id === person.id));
      const preview = el('div', undefined, 'character-card-preview');
      card.append(preview, el('strong', person.name)); gallery.append(card);
      void readAsset(person.assetId).then(asset => {
        if (!asset || !preview.isConnected) return;
        const image = el('img'); image.src = urlFor(asset); image.alt = person.name; image.draggable = false; preview.append(image);
      }).catch(() => {});
    }
    add.disabled = edit.disabled = !selected;
    reference.disabled = !selected || !canReference;
    reference.title = canReference ? 'Dùng ảnh nhân vật trong node đang chọn' : 'Chọn một node tạo ảnh/video trước khi mở thư viện';
  }
  function editPerson(person = null) {
    const editDialog = el('dialog', undefined, 'character-edit-dialog'), form = el('form'), name = el('input'), notes = el('textarea'), file = el('input'),
      personGender = el('select'), personAge = el('select'), personRegion = el('input');
    name.value = person?.name || ''; name.required = true; name.maxLength = 100;
    notes.value = person?.prompt || ''; notes.maxLength = 2000; notes.rows = 3;
    file.type = 'file'; file.accept = 'image/*'; file.required = !person;
    for (const value of ['', 'Nữ', 'Nam', 'Khác']) personGender.add(new Option(value || 'Chưa ghi', value));
    for (const value of ['', 'Trẻ em', 'Thanh niên', 'Trung niên', 'Cao tuổi']) personAge.add(new Option(value || 'Chưa ghi', value));
    personGender.value = person?.gender || ''; personAge.value = person?.ageGroup || ''; personRegion.value = person?.region || ''; personRegion.maxLength = 100;
    form.append(el('h2', person ? 'Chỉnh sửa nhân vật' : 'Tạo nhân vật mới'));
    for (const [label, control] of [['Tên nhân vật', name], ['Mô tả', notes], ['Ảnh nhân vật', file], ['Giới tính', personGender], ['Nhóm tuổi', personAge], ['Khu vực', personRegion]]) {
      const row = el('label', label); control.setAttribute('aria-label', label); row.append(control); form.append(row);
    }
    const actions = el('div', undefined, 'project-actions'), save = el('button', 'Lưu nhân vật'); save.type = 'submit';
    actions.append(button('Hủy', () => editDialog.close()));
    if (person) actions.append(button('Xóa nhân vật', async () => {
      if (!confirm('Xóa nhân vật khỏi thư viện? Ảnh gốc vẫn ở trong Kho.')) return;
      await remove('characters', person.id); selected = null; editDialog.close(); await load();
    }));
    actions.append(save); form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      try {
        if (!name.value.trim()) throw Error('Tên nhân vật không được để trống.');
        let assetId = person?.assetId;
        if (file.files[0]) assetId = (await addAsset(file.files[0], { projectId })).id;
        if (!assetId) throw Error('Cần ảnh nhân vật.');
        const now = new Date().toISOString();
        const item = { ...person, id: person?.id || crypto.randomUUID(), name: name.value.trim(), prompt: notes.value.trim(), assetId, gender: personGender.value, ageGroup: personAge.value, region: personRegion.value.trim(), createdAt: person?.createdAt || now, updatedAt: now };
        await write('characters', item); selected = item; editDialog.close(); await load();
      } catch (error) { notice(error.message); }
      finally { save.disabled = false; }
    };
    editDialog.append(form); dialog.append(editDialog);
    editDialog.addEventListener('close', () => editDialog.remove(), { once: true }); editDialog.showModal();
  }
  try { await load(); } catch (error) { notice(error.message); }
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
