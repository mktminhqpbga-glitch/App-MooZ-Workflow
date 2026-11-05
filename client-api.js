export async function api(path, body) {
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
