import { api, el, button, notice, providerList } from './client-api.js';
import { getAssistantTab } from './core/assistant-tab.js';

export function mountAssistantSettings(host) {
  const panel = el('section', undefined, 'settings-panel assistant-settings'),
    service = el('select'), tabs = el('select'), status = el('p', '', 'intro');
  panel.append(el('h2', 'Trợ lý AI'), el('p', 'Dành riêng một tab cho trợ lý. Tab này không xuất hiện trong lựa chọn chạy ảnh/video hoặc tác vụ hàng loạt.', 'intro'));
  service.setAttribute('aria-label', 'Dịch vụ trợ lý AI');
  tabs.setAttribute('aria-label', 'Tab dành riêng cho trợ lý AI');
  for (const provider of providerList.filter(provider => provider.types.includes('text') && !['openai', 'google'].includes(provider.id))) service.add(new Option(provider.name, provider.id));
  const saved = getAssistantTab();
  if (saved) service.value = saved.provider;
  tabs.add(new Option('Chọn tab trợ lý…', ''));
  let version = 0, userEditing = false;
  const save = button('Dành tab này cho trợ lý', async () => {
    if (!tabs.value) throw Error('Chọn tab trợ lý trước.');
    await api('assistant/config', { tab: { provider: service.value, tabId: Number(tabs.value), chatURL: tabs.selectedOptions[0].dataset.url } });
    showStatus(); notice('Đã dành riêng tab cho Trợ lý AI.');
  });
  const clear = button('Bỏ tab trợ lý', async () => { await api('assistant/config', { tab: null }); showStatus(); await refreshTabs(); });
  function showStatus() {
    const selected = getAssistantTab();
    status.textContent = selected ? 'Tab đã chọn: ' + (selected.title || selected.chatURL) : 'Chưa chọn tab trợ lý.';
    clear.disabled = !selected;
  }
  async function refreshTabs() {
    const revision = ++version;
    save.disabled = true;
    tabs.disabled = true;
    try {
      const available = await api('tabs?provider=' + service.value + '&purpose=assistant-setup');
      if (revision !== version || !panel.isConnected) return;
      tabs.replaceChildren(new Option('Chọn tab trợ lý…', ''));
      const current = getAssistantTab();
      for (const tab of available) {
        const option = new Option((tab.title || tab.url) + (tab.id === current?.tabId ? ' · Trợ lý hiện tại' : ''), tab.id);
        option.dataset.url = tab.url; tabs.add(option);
      }
      if (current?.provider === service.value && available.some(tab => tab.id === current.tabId)) tabs.value = String(current.tabId);
      showStatus();
      if (!available.length) status.textContent += ' Chưa có tab kết nối; ghép Chrome rồi cập nhật danh sách.';
    } catch (error) { if (panel.isConnected) status.textContent = error.message; }
    finally { if (revision === version) { save.disabled = !tabs.value; tabs.disabled = false; } }
  }
  service.onchange = () => { userEditing = true; void refreshTabs(); };
  tabs.onchange = () => { userEditing = true; save.disabled = !tabs.value; };
  const controls = el('div', undefined, 'assistant-setting-controls');
  controls.append(service, tabs, button('Cập nhật tab trợ lý', refreshTabs), save, clear);
  panel.append(controls, status); host.append(panel); showStatus();
  void api('assistant/config').then(() => { if (panel.isConnected && !userEditing) { const current = getAssistantTab(); if (current) service.value = current.provider; return refreshTabs(); } }).catch(error => { if (panel.isConnected) status.textContent = error.message; });
}

export function mountAssistantChat(container, { projectId, signal, onCreate }) {
  const status = el('p', '', 'assistant-chat-status'), transcript = el('div', undefined, 'assistant-transcript'),
    form = el('form', undefined, 'assistant-chat-form'), input = el('textarea'), send = el('button', 'Gửi cho trợ lý'),
    settings = el('a', 'Chọn tab trợ lý trong Cài đặt →');
  const key = 'mooz-assistant-chat-' + projectId;
  let messages = [], busy = false;
  try { messages = JSON.parse(localStorage.getItem(key) || '[]').filter(message => ['user', 'assistant', 'status'].includes(message.role) && typeof message.text === 'string').slice(-60); } catch {}
  settings.href = '#settings'; settings.className = 'assistant-settings-link';
  input.rows = 3; input.maxLength = 50000; input.placeholder = 'Nhập yêu cầu cho trợ lý AI…'; input.setAttribute('aria-label', 'Tin nhắn cho trợ lý AI');
  send.type = 'submit';
  form.append(input, send);
  container.append(status, settings, transcript, form);
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(messages.slice(-60))); } catch {} };
  const render = () => {
    const selected = getAssistantTab();
    status.textContent = selected ? 'Trợ lý dùng tab: ' + (selected.title || selected.chatURL) : 'Chưa có tab dành riêng cho trợ lý.';
    send.disabled = busy || !selected;
    transcript.replaceChildren();
    for (const message of messages) {
      const row = el('div', undefined, 'assistant-chat-message assistant-message-' + message.role);
      row.append(el('small', message.role === 'user' ? 'Bạn' : message.role === 'assistant' ? 'Trợ lý AI' : 'Trạng thái'), el('p', message.text));
      transcript.append(row);
    }
    transcript.scrollTop = transcript.scrollHeight;
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !input.value.trim()) return;
    if (!getAssistantTab()) { notice('Chọn tab trợ lý trong Cài đặt trước.'); return; }
    const prompt = input.value.trim();
    busy = true; input.value = ''; messages.push({ role: 'user', text: prompt }); persist(); render(); send.textContent = 'Đang chờ trợ lý…';
    try {
      const response = await api('assistant/messages', { requestId: crypto.randomUUID(), prompt });
      if (response.status === 'success' && response.result?.kind === 'text') messages.push({ role: 'assistant', text: response.result.text });
      else messages.push({ role: 'status', text: response.error || 'Chưa xác nhận được kết quả. Không tự gửi lại yêu cầu.' });
    } catch (error) { messages.push({ role: 'status', text: error.message }); }
    finally { busy = false; persist(); send.textContent = 'Gửi cho trợ lý'; if (container.isConnected) render(); }
  };
  input.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); } };
  const drafts = el('div', undefined, 'creative-assistant-actions');
  drafts.append(button('Tạo node ảnh', () => onCreate('generateImage', input.value)), button('Tạo node video', () => onCreate('generateVideo', input.value)));
  container.append(drafts);
  window.addEventListener('mooz-assistant-tab-change', () => { if (container.isConnected) render(); }, { signal });
  window.addEventListener('storage', () => { if (container.isConnected) render(); }, { signal });
  render();
}
