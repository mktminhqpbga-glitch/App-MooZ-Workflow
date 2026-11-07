const form = document.querySelector<HTMLFormElement>("form")!;
const status = document.querySelector<HTMLElement>("#status")!;
const identity = document.querySelector<HTMLElement>("#identity")!;
async function refresh() {
  const value = await chrome.runtime.sendMessage({ type: "status" });
  status.textContent = value.connected ? "Đã kết nối Toonflow" : value.error || "Chưa kết nối";
  identity.textContent = `Chrome: ${value.deviceId}\nPhiên: ${value.epoch}`;
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const uri = document.querySelector<HTMLInputElement>("#pairing")!.value.trim(), parsed = new URL(uri);
    const endpoint = new URL(parsed.searchParams.get("endpoint") ?? "");
    if (endpoint.protocol !== "wss:" && !(endpoint.protocol === "ws:" && endpoint.hostname === "127.0.0.1")) throw new Error("Relay cần WSS hoặc địa chỉ loopback");
    const origin = `${endpoint.protocol === "wss:" ? "https:" : "http:"}//${endpoint.hostname}/*`;
    if (!await chrome.permissions.request({ origins: [origin] })) throw new Error("Cần cấp quyền tới relay đã chọn");
    const result = await chrome.runtime.sendMessage({ type: "connect", uri });
    if (result.error) throw new Error(result.error);
    status.textContent = "Đang ghép Chrome…";
    setTimeout(() => { void refresh(); }, 1500);
  } catch (error) { status.textContent = error instanceof Error ? error.message : "Không ghép được Chrome"; }
});
void refresh();
