const key = 'mooz-cvn-assistant-tab';
export function getAssistantTab() {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && Number.isSafeInteger(value.tabId) && typeof value.provider === 'string' ? value : null;
  } catch { return null; }
}
export function cacheAssistantTab(value) {
  try {
    const serialized = JSON.stringify(value || null);
    if (localStorage.getItem(key) === serialized) return;
    localStorage.setItem(key, serialized);
    window.dispatchEvent(new CustomEvent('mooz-assistant-tab-change'));
  } catch {}
}
export function assertWorkflowTabAvailable(tabId) {
  const assistant = getAssistantTab();
  if (assistant && Number(tabId) === assistant.tabId)
    throw Error('Tab này dành riêng cho Trợ lý AI. Chọn tab khác để chạy công việc.');
}
