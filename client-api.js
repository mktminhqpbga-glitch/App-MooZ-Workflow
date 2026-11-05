import { getAssistantTab, cacheAssistantTab, assertWorkflowTabAvailable } from "./core/assistant-tab.js";
function removeReservedWorkflowOptions() {
  const assistant = getAssistantTab();
  if (!assistant) return;
  for (const select of document.querySelectorAll('select[aria-label="Tab chạy luồng"],select[aria-label="Tab hàng loạt"],select[aria-label="Tab cần kiểm tra"]')) {
    const wasSelected = Number(select.value) === assistant.tabId;
    for (const option of [...select.options]) if (Number(option.value) === assistant.tabId) option.remove();
    if (wasSelected) { select.value = ""; select.dispatchEvent(new Event("change")); }
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("mooz-assistant-tab-change", removeReservedWorkflowOptions);
  window.addEventListener("storage", removeReservedWorkflowOptions);
}
export async function api(path, body) {
  if (path === "jobs" && body && !["google", "openai"].includes(body.provider))
    assertWorkflowTabAvailable(body.tabId);
  const key = sessionStorage.getItem("mooz-server-access") || "";
  let response;
  try {
    response = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "x-mooz-client": "web",
        "x-mooz-access": key,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw Error(
      "Mất kết nối máy chủ. Kiểm tra lượt đã gửi trước khi chạy lại.",
    );
  }
  // A static SPA fallback returns HTML for /api/*, never a successful API result.
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw Error("Bản web tĩnh chưa có máy chủ kết nối AI.");
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error || "Máy chủ trả HTTP " + response.status);
  if ((path === "status" || path === "assistant/config") && Object.hasOwn(data, "assistantTab")) cacheAssistantTab(data.assistantTab);
  if (path.startsWith("tabs?") && new URLSearchParams(path.split("?")[1]).get("purpose") !== "assistant-setup" && Array.isArray(data)) {
    const assistant = getAssistantTab();
    return assistant ? data.filter(tab => tab.id !== assistant.tabId) : data;
  }
  return data;
}
export const providerList = [
  { id: "muse", name: "Muse · Chrome", types: ["text", "image", "video"] },
  { id: "gemini", name: "Gemini · Chrome", types: ["text", "image"] },
  { id: "chatgpt", name: "ChatGPT · Chrome", types: ["text", "image"] },
  { id: "grok", name: "Grok · Chrome", types: ["text", "image", "video"] },
  { id: "flow", name: "Google Flow · Chrome", types: ["image", "video"] },
  { id: "openai", name: "OpenAI · API", types: ["text", "image"] },
  { id: "google", name: "Gemini · API", types: ["text", "image"] },
];
const connectedAICache = new Map();
export function connectedAI(kind) {
  const cached = connectedAICache.get(kind);
  if (cached && Date.now() - cached.at < 3000) return cached.promise;
  const promise = loadConnectedAI(kind);
  connectedAICache.set(kind, { at: Date.now(), promise });
  return promise;
}
async function loadConnectedAI(kind) {
  const status = await api("status"), available = [];
  const candidates = providerList.filter(provider => provider.types.includes(kind));
  const chrome = status.chrome?.connected ? candidates.filter(provider => !["openai", "google"].includes(provider.id)) : [];
  const tabs = await Promise.allSettled(chrome.map(async provider => ({ ...provider, tabs: await api("tabs?provider=" + provider.id) })));
  for (const result of tabs) if (result.status === "fulfilled" && result.value.tabs.length) available.push(result.value);
  for (const provider of candidates.filter(provider => ["openai", "google"].includes(provider.id)))
    if (status.providers?.some(item => item.id === provider.id && item.ready && item.types?.includes(kind))) available.push({ ...provider, tabs: [] });
  return available;
}
export function notice(message) {
  const h = document.getElementById("toast");
  h.textContent = message;
  h.hidden = false;
  setTimeout(() => {
    if (h.textContent === message) h.hidden = true;
  }, 6500);
}
export const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
export function button(text, fn, cls) {
  const b = el("button", text, cls);
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      notice(e.message);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
