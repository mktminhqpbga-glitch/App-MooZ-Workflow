declare function importScripts(...urls: string[]): void;
importScripts("bridge/aiSites.js", "bridge/aiActivityWorker.js");

type Settings = { endpoint: string; token: string; pairing: boolean; enabled: boolean };
type Delivery = { state: "uncertain" | "accepted" | "notSent" | "acknowledged"; at: number };
let socket: WebSocket | undefined;
let connecting: Promise<void> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let lifecycle = 0;
let lastError = "";
let connected = false;
let sends = Promise.resolve();
let storageWrites = Promise.resolve();
const gateCalls = new Map<string, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
const chunks = new Map<string, { total: number; body: string; at: number }>();
const scriptFiles = new Set(["bridge/aiActivity.js", "bridge/composerControls.js", "bridge/museBridge.js"]);
const messageTypes = new Set(["MUSEFLOW_CHECK_SESSION", "MUSEFLOW_JOB_START", "MUSEFLOW_JOB_STATUS", "MUSEFLOW_JOB_ACK"]);
const isMuse = (value?: string) => { try { const url = new URL(value ?? ""); return url.protocol === "https:" && (url.hostname === "muse.ai" || url.hostname.endsWith(".muse.ai")); } catch { return false; } };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const errorText = (error: unknown) => error instanceof Error ? error.message : "Chrome connection failed";

function parsePairing(value: string): Settings {
  const code = new URL(value), endpoint = new URL(code.searchParams.get("endpoint") ?? "");
  if (code.protocol !== "toonflow-connect:" || code.hostname !== "pair" || code.username || code.password || code.hash
    || [...code.searchParams.keys()].sort().join(",") !== "endpoint,token"
    || !/^[a-f0-9]{64}$/.test(code.searchParams.get("token") ?? "")
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/connect"
    || !(endpoint.protocol === "wss:" || endpoint.protocol === "ws:" && endpoint.hostname === "127.0.0.1")) throw new Error("Mã ghép không hợp lệ");
  return { endpoint: endpoint.href, token: code.searchParams.get("token")!, pairing: true, enabled: true };
}
function originFor(endpoint: string) { const url = new URL(endpoint); return `${url.protocol === "wss:" ? "https:" : "http:"}//${url.hostname}/*`; }
async function identities() {
  const local = await chrome.storage.local.get("deviceId"), session = await chrome.storage.session.get("epoch");
  const deviceId = local.deviceId ?? crypto.randomUUID(), epoch = session.epoch ?? crypto.randomUUID();
  await chrome.storage.local.set({ deviceId }); await chrome.storage.session.set({ epoch });
  return { deviceId, epoch };
}
function status() { return { connected, error: lastError }; }
async function send(value: unknown) {
  const target = socket, text = JSON.stringify(value);
  if (!target || target.readyState !== WebSocket.OPEN) throw new Error("Relay chưa kết nối");
  if (text.length > 128 * 1024 * 1024) throw new Error("Kết quả vượt giới hạn truyền");
  const run = sends.catch(() => {}).then(async () => {
    const id = crypto.randomUUID();
    for (let offset = 0; offset < text.length; offset += 32_000) {
      while (target.bufferedAmount > 256_000) { if (target.readyState !== 1) throw new Error("Relay ngắt kết nối"); await sleep(10); }
      if (target.readyState !== 1) throw new Error("Relay ngắt kết nối");
      target.send(text.length < 32_000 ? text : JSON.stringify({ type: "chunk", id, offset, total: text.length, body: text.slice(offset, offset + 32_000) }));
    }
  });
  sends = run; await run;
}
async function recordDelivery(id: string, state: Delivery["state"]) {
  const write = storageWrites.catch(() => {}).then(async () => {
    const data = await chrome.storage.local.get("deliveries"), records = (data.deliveries ?? {}) as Record<string, Delivery>;
    records[id] = { state, at: Date.now() };
    const finished = Object.entries(records).filter(([, value]) => value.state === "acknowledged").sort((a, b) => a[1].at - b[1].at);
    for (const [key] of finished.slice(0, Math.max(0, finished.length - 200))) delete records[key];
    await chrome.storage.local.set({ deliveries: records });
  });
  storageWrites = write; await write;
}
async function perform(operation: string, payload: Record<string, any>) {
  if (operation === "tabs.query") return (await chrome.tabs.query({})).filter(tab => isMuse(tab.url)).map(({ id, url, title }) => ({ id, url, title }));
  if (!Number.isSafeInteger(payload.id)) throw new Error("Tab ID không hợp lệ");
  const tab = await chrome.tabs.get(payload.id);
  if (!isMuse(tab.url)) throw new Error("Tab không còn là Muse");
  if (operation === "tabs.get") return { id: tab.id, url: tab.url, title: tab.title };
  if (operation === "tabs.script") {
    if (!Array.isArray(payload.files) || payload.files.some(file => !scriptFiles.has(file))) throw new Error("Tệp bridge không được phép");
    return chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: payload.files });
  }
  const message = payload.message;
  if (operation !== "tabs.message" || !messageTypes.has(message?.type)) throw new Error("Lệnh không được phép");
  if (message.type === "MUSEFLOW_JOB_START") {
    if (typeof message.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(message.requestId)) throw new Error("Request ID không hợp lệ");
    await storageWrites;
    const saved = await chrome.storage.local.get("deliveries"), previous = (saved.deliveries as Record<string, Delivery> | undefined)?.[message.requestId];
    if (previous && previous.state !== "notSent") return { ok: true, accepted: true, requestId: message.requestId, reconcileOnly: true };
    // Persist before any content-script call. An ambiguous response never permits a second send.
    await recordDelivery(message.requestId, "uncertain");
    const result = await chrome.tabs.sendMessage(tab.id!, message);
    await recordDelivery(message.requestId, result?.code === "TAB_BUSY" ? "notSent" : result?.ok ? "accepted" : "uncertain");
    return result;
  }
  const result = await chrome.tabs.sendMessage(tab.id!, message);
  if (message.type === "MUSEFLOW_JOB_ACK" && result?.ok) await recordDelivery(message.requestId, "acknowledged");
  return result;
}
async function ingest(message: any) {
  if (message?.type === "chunk") {
    if (typeof message.id !== "string" || !Number.isSafeInteger(message.total) || message.total < 1 || message.total > 128 * 1024 * 1024
      || !Number.isSafeInteger(message.offset) || typeof message.body !== "string" || message.body.length > 32_000) throw new Error("Invalid chunk");
    for (const [id, item] of chunks) if (item.at + 60_000 < Date.now()) chunks.delete(id);
    let item = chunks.get(message.id);
    if (!item) {
      if (chunks.size >= 2 || message.offset !== 0) throw new Error("Invalid chunk order");
      item = { total: message.total, body: "", at: Date.now() }; chunks.set(message.id, item);
    }
    if (item.total !== message.total || item.body.length !== message.offset || message.offset + message.body.length > item.total) throw new Error("Invalid chunk order");
    item.body += message.body;
    if (item.body.length === item.total) { chunks.delete(message.id); await ingest(JSON.parse(item.body)); }
    return;
  }
  if (message?.type === "ready") {
    if (message.protocol !== 1) throw new Error("Relay protocol mismatch");
    if (message.browserToken) {
      const { connection } = await chrome.storage.local.get("connection") as { connection: Settings };
      await chrome.storage.local.set({ connection: { ...connection, token: message.browserToken, pairing: false } });
    }
    connected = true; lastError = ""; return;
  }
  if (message?.type === "gate-result") {
    const call = gateCalls.get(message.callId);
    if (call) { clearTimeout(call.timer); gateCalls.delete(message.callId); call.resolve(message.result); }
    return;
  }
  if (!connected || message?.type !== "request" || typeof message.id !== "string") return;
  try { await send({ type: "response", id: message.id, result: await perform(message.operation, message.payload ?? {}) }); }
  catch (error) { await send({ type: "response", id: message.id, error: errorText(error) }); }
}
async function connect() {
  if (connecting) return connecting;
  const task = (async () => {
    const { connection } = await chrome.storage.local.get("connection") as { connection?: Settings };
    if (!connection?.enabled || socket?.readyState === 0 || connected) return;
    if (!await chrome.permissions.contains({ origins: [originFor(connection.endpoint)] })) throw new Error("Chưa cấp quyền tới relay");
    const identity = await identities(), generation = ++lifecycle;
    clearInterval(heartbeat); socket?.close();
    const current = new WebSocket(connection.endpoint); socket = current;
    current.onopen = () => { if (generation !== lifecycle) { current.close(); return; } current.send(JSON.stringify({ type: "auth", ...identity, token: connection.token, pairing: connection.pairing })); };
    current.onmessage = event => { if (socket !== current) return; void ingest(JSON.parse(event.data)).catch(error => { lastError = errorText(error); current.close(1008); }); };
    current.onclose = () => {
      if (socket !== current) return;
      connected = false; socket = undefined; clearInterval(heartbeat);
      for (const call of gateCalls.values()) { clearTimeout(call.timer); call.resolve({ ok: false, error: "Relay disconnected; do not send again" }); } gateCalls.clear();
      chunks.clear(); setTimeout(() => { void connect().catch(error => { lastError = errorText(error); }); }, 5000);
    };
    current.onerror = () => { lastError = "Không kết nối được relay. Kiểm tra địa chỉ và mã ghép."; };
    heartbeat = setInterval(() => { if (current.readyState === 1) current.send(JSON.stringify({ type: "ping" })); }, 20_000);
  })();
  connecting = task;
  try { await task; } finally { connecting = undefined; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "WORKFLOW_AI_GATE" && sender.tab?.id !== undefined && sender.frameId === 0 && isMuse(sender.url)) {
    const callId = crypto.randomUUID();
    const timer = setTimeout(() => { gateCalls.delete(callId); respond({ ok: false, error: "Send permission could not be confirmed" }); }, 15_000);
    gateCalls.set(callId, { resolve: respond, timer });
    void send({ type: "gate", callId, tabId: sender.tab.id, message: { requestId: message.requestId, token: message.token, operation: message.operation } })
      .catch(() => { clearTimeout(timer); gateCalls.delete(callId); respond({ ok: false, error: "Relay disconnected" }); });
    return true;
  }
  if (sender.tab || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  if (message?.type === "status") { void identities().then(identity => respond({ ...status(), ...identity })); return true; }
  if (message?.type === "connect") {
    void (async () => {
      const next = parsePairing(message.uri);
      if (!await chrome.permissions.contains({ origins: [originFor(next.endpoint)] })) throw new Error("Chưa cấp quyền relay");
      lifecycle++; connected = false; socket?.close(); socket = undefined;
      await chrome.storage.local.set({ connection: next }); await connect(); respond(status());
    })().catch(error => respond({ error: errorText(error) }));
    return true;
  }
  return false;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "relayReconnect") void connect().catch(error => { lastError = errorText(error); }); });
void chrome.alarms.create("relayReconnect", { periodInMinutes: 1 });
void connect().catch(error => { lastError = errorText(error); });
