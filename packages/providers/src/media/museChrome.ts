const rules = [
  { type: "input", field: "relayUrl", title: "Relay HTTPS / loopback", value: "http://127.0.0.1:4176" },
  { type: "input", field: "controllerToken", title: "Relay controller token", value: "", props: { type: "password", showPassword: true } },
  { type: "input", field: "deviceId", title: "Chrome device ID", value: "" },
  { type: "input", field: "epoch", title: "Chrome session", value: "" },
  { type: "input", field: "tabId", title: "Muse tab ID", value: "" },
  { type: "input", field: "conversationUrl", title: "Muse conversation URL", value: "" },
] as const;
type Context = ProviderContext<ProviderConfig<typeof rules>>;
type Receipt = ProviderTaskData & { requestId: string; requestCode: string; relayUrl: string; deviceId: string; epoch: string; tabId: number; conversationUrl: string; fingerprint: string; request: ProviderTaskData; phase: string };
type Tab = { id: number; url: string };
type Poll = { ok?: boolean; state?: string; result?: { videoResultProtocol?: number; ok?: boolean; error?: string; partial?: boolean; expectedItems?: number; items?: { id: string; url: string }[]; url?: string; conversationUrl?: string; receipt?: { requestId: string; requestCode: string; sentTurnMatchesRequestId: boolean } } };

function relayUrl(context: Context) {
  const value = new URL(context.config.relayUrl);
  if (value.username || value.password || value.search || value.hash || value.pathname !== "/"
    || !(value.protocol === "https:" || value.protocol === "http:" && value.hostname === "127.0.0.1")) throw new Error("Relay cần HTTPS hoặc loopback HTTP");
  if (context.config.controllerToken.length < 32) throw new Error("Chưa cấu hình relay controller token");
  return value.origin;
}
async function api<T>(context: Context, path: string, body?: unknown): Promise<T> {
  const response = await context.tool.fetch(`${relayUrl(context)}${path}`, {
    method: body === undefined ? "GET" : "POST", redirect: "error",
    headers: { Authorization: `Bearer ${context.config.controllerToken}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(75_000),
  });
  if (!response.ok) throw Object.assign(new Error(`Chrome relay HTTP ${response.status}; giữ nguyên request để đối chiếu`), { status: response.status });
  return await response.json() as T;
}
function pause(context: Context) {
  context.signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(context.signal?.reason); };
    const timer = setTimeout(() => { context.signal?.removeEventListener("abort", cancel); resolve(); }, 2000);
    context.signal?.addEventListener("abort", cancel, { once: true });
    if (context.signal?.aborted) cancel();
  });
}
async function call<T>(context: Context, data: Receipt, operation: string, payload: unknown): Promise<T> {
  return api(context, "/api/call", { deviceId: data.deviceId, epoch: data.epoch, tabId: data.tabId, operation, payload });
}
function muse(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !(url.hostname === "muse.ai" || url.hostname.endsWith(".muse.ai")) || url.username || url.password) throw new Error("Chọn đúng URL cuộc trò chuyện Muse");
  return url;
}
function sameConversation(original: string, current: string, allowAssigned: boolean) {
  const from = muse(original), to = muse(current);
  if (from.href.replace(/\/$/, "") === to.href.replace(/\/$/, "")) return true;
  return allowAssigned && from.host === to.host && !from.search && !from.hash && ["/", "/new", "/chat", "/chat/new"].includes(from.pathname);
}
function receipt(context: Context, input: ProviderTaskData): Receipt {
  if (input.requestId !== context.taskId || input.relayUrl !== relayUrl(context) || typeof input.requestCode !== "string"
    || typeof input.deviceId !== "string" || typeof input.epoch !== "string" || !Number.isSafeInteger(input.tabId)
    || typeof input.conversationUrl !== "string" || !input.request || typeof input.request !== "object" || Array.isArray(input.request)) throw new Error("Browser receipt không khớp task hoặc relay đã đổi");
  muse(input.conversationUrl);
  return input as Receipt;
}
async function waitForResult(context: Context, data: Receipt): Promise<MediaAsset[]> {
  await api(context, "/api/dispatch", {
    deviceId: data.deviceId, epoch: data.epoch, tabId: data.tabId, conversationUrl: data.conversationUrl,
    requestId: data.requestId, requestCode: data.requestCode, fingerprint: data.fingerprint,
  });
  const mediaType = data.request.mediaType === "video" ? "video" : "image";
  while (true) {
    context.signal?.throwIfAborted();
    let tab: Tab;
    try { tab = await call<Tab>(context, data, "tabs.get", { id: data.tabId }); }
    catch (error) {
      if ([400, 401, 403].includes(Number((error as { status?: number }).status))) throw error;
      await pause(context); continue;
    }
    const dispatch = await api<{ phase: string }>(context, `/api/dispatch/${data.requestId}`);
    if (!sameConversation(data.conversationUrl, tab.url, ["permitted", "sent"].includes(dispatch.phase))) throw new Error("Tab đã chuyển cuộc trò chuyện; không gửi lại");
    await call(context, data, "tabs.script", { id: data.tabId, files: ["bridge/aiActivity.js", "bridge/composerControls.js", "bridge/museBridge.js"] });
    const poll = await call<Poll>(context, data, "tabs.message", { id: data.tabId, message: { type: "MUSEFLOW_JOB_STATUS", requestId: data.requestId } });
    if (poll.state === "missing") {
      if (dispatch.phase !== "registered") throw new Error("Chrome mất receipt của lượt đã cấp quyền gửi. Kiểm tra tab gốc; không tạo lại ảnh");
      const health = await call<{ busy?: boolean; composer?: boolean; signedIn?: boolean; nativeProtocol?: number; videoResultProtocol?: number; modeProtocol?: number }>(context, data, "tabs.message", { id: data.tabId, message: { type: "MUSEFLOW_CHECK_SESSION" } });
      if (health.busy) { await pause(context); continue; }
      if (mediaType === "video" && (health.videoResultProtocol !== 1 || health.modeProtocol !== 1)) throw new Error("Cập nhật extension để nhận video đúng giao thức.");
      if (!health.composer || !health.signedIn || health.nativeProtocol !== 1) throw new Error("Đăng nhập Muse và tải lại tab với Toonflow Chrome Connect");
      const claimed = await api<{ dispatchToken: string }>(context, "/api/dispatch", {
        deviceId: data.deviceId, epoch: data.epoch, tabId: data.tabId, conversationUrl: data.conversationUrl,
        requestId: data.requestId, requestCode: data.requestCode, fingerprint: data.fingerprint,
      });
      const accepted = await call<{ ok?: boolean; code?: string; reconcileOnly?: boolean }>(context, data, "tabs.message", {
        id: data.tabId, message: { ...data.request, dispatchToken: claimed.dispatchToken },
      });
      if (accepted.code === "TAB_BUSY") { await pause(context); continue; }
      if (!accepted.ok || accepted.reconcileOnly) throw new Error("Lượt gửi chưa xác định và tab không giữ receipt; kiểm tra tab gốc, không tự gửi lại");
    }
    if (poll.state === "done") {
      const result = poll.result;
      if (!result?.ok) throw new Error(result?.error ?? "Muse chưa trả kết quả hợp lệ");
      if (mediaType === "video" && result.videoResultProtocol !== 1) throw new Error("Video không có bằng chứng giao thức kết quả.");
      if (result.partial) { await pause(context); continue; }
      const evidence = result.receipt;
      if (evidence?.requestId !== data.requestId || evidence.requestCode !== data.requestCode || !evidence.sentTurnMatchesRequestId
        || !result.conversationUrl || !sameConversation(data.conversationUrl, result.conversationUrl, true)) throw new Error("Kết quả không có bằng chứng đúng lượt/đúng cuộc trò chuyện");
      const items = result.items ?? (result.url ? [{ id: "image", url: result.url }] : []);
      const expected = result.expectedItems ?? items.length;
      if (!items.length || items.length > 16 || expected !== items.length || new Set(items.map(item => item.id)).size !== items.length) throw new Error("Manifest ảnh chưa đầy đủ");
      const assets: MediaAsset[] = [];
      for (const item of items) {
        const pattern = mediaType === "image" ? /^data:image\/(?:png|jpeg|webp);base64,/ : /^data:video\/(?:mp4|webm|quicktime);base64,/;
        if (!pattern.test(item.url) || item.url.length > 140 * 1024 * 1024) throw new Error("Extension phải trả byte media thật, đúng loại kết quả.");
        const bytes = Buffer.from(item.url.slice(item.url.indexOf(",") + 1), "base64");
        if (mediaType === "image") {
          const info = await new context.tool.image(bytes).metadata();
          if (!info.width || !info.height) throw new Error("Ảnh chưa giải mã được");
        } else if (!(bytes.length > 12 && (bytes.subarray(4, 8).toString() === "ftyp" || bytes.readUInt32BE(0) === 0x1a45dfa3))) throw new Error("Kết quả chưa phải file video MP4/WebM.");
        assets.push({ type: "base64", mediaType, data: item.url, mimeType: item.url.slice(5, item.url.indexOf(";")) });
      }
      await context.saveTaskData?.({ ...data, phase: "received" });
      return assets;
    }
    await pause(context);
  }
}

async function submit(context: Context, request: ImageRequest | VideoRequest, mediaType: "image" | "video"): Promise<MediaAsset[]> {
    if (!context.taskId || !context.saveTaskData) throw new Error("Chrome cần task bền vững của Toonflow");
    if ("mask" in request && request.mask) throw new Error("Muse Chrome chưa hỗ trợ gửi mask chỉnh sửa; dùng tác vụ ảnh với tham chiếu thông thường");
    if (mediaType === "video") {
      if (("videos" in request && request.videos?.length) || ("audios" in request && request.audios?.length) || ("firstFrame" in request && request.firstFrame) || ("lastFrame" in request && request.lastFrame)) throw new Error("Muse Chrome nhận văn bản và ảnh tham chiếu; dùng model hỗ trợ để chạy khung đầu/cuối hoặc nối dài.");
      await context.tool.ffmpeg();
    }
    const deviceId = context.config.deviceId.trim(), epoch = context.config.epoch.trim(), tabId = Number(context.config.tabId);
    if (![deviceId, epoch].every(id => /^[a-f0-9-]{36}$/i.test(id)) || !Number.isSafeInteger(tabId) || tabId < 0) throw new Error("Chọn Chrome và tab Muse trong Chrome Connect");
    const conversationUrl = muse(context.config.conversationUrl.trim()).href;
    if ((request.images?.length ?? 0) > 8) throw new Error("Tối đa 8 ảnh tham chiếu");
    const referenceImages = (request.images ?? []).map(image => {
      if (image.type !== "base64" || !image.mimeType.startsWith("image/")) throw new Error("Ảnh tham chiếu phải được Toonflow đọc thành byte trước khi gửi");
      if (image.data.length > 12 * 1024 * 1024) throw new Error("Mỗi ảnh tham chiếu tối đa 8 MB");
      return `data:${image.mimeType};base64,${image.data}`;
    });
    if (referenceImages.join("").length > 32 * 1024 * 1024) throw new Error("Tổng ảnh tham chiếu vượt 24 MB");
    const requestCode = `TF-${context.taskId}`;
    const input = {
      type: "MUSEFLOW_JOB_START", requestId: context.taskId, requestCode, provider: "muse", mediaType,
      prompt: `${request.prompt}\n[MOOZ_REQUEST:${requestCode}]\nMã đối chiếu không phải nội dung media; không vẽ mã lên kết quả.`,
      referenceImages, chatTarget: { tabId, url: conversationUrl }, dispatchProtocol: 1,
      size: request.ratio ?? "1:1",
    };
    const data: Receipt = { requestId: context.taskId, requestCode, relayUrl: relayUrl(context), deviceId, epoch, tabId, conversationUrl,
      request: input, fingerprint: context.tool.sha256(JSON.stringify(input)), phase: "prepared" };
    await context.saveTaskData(data);
    return waitForResult(context, data);
}

export default {
  id: "museChrome", label: "Muse · Chrome", icon: "", version: "0.2.0", rules,
  readme: "Sinh ảnh và video qua Chrome trên máy này, máy khác hoặc VM. Ghép browser trong mục Chrome Connect, chọn tab Muse rồi chọn model tại website. Chỉ ACK sau khi Toonflow lưu đủ file. Cần relay và Toonflow standalone; không dùng API Key của Muse.",
  models: [{ id: "museImage", label: "Muse · model đang chọn trên tab", type: "image", mode: ["text", "singleImage", "multiReference"] }, { id: "museVideo", label: "Muse · Video trên Chrome", type: "video", mode: ["text", ["imageReference:8"]] }],
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> { return submit(this, request, "image"); },
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> { return submit(this, request, "video"); },
  async resumeTask(data: ProviderTaskData): Promise<MediaAsset[]> { return waitForResult(this, receipt(this, data)); },
  async acknowledgeTask(input: ProviderTaskData) {
    const data = receipt(this, input);
    const result = await api<{ ok: boolean }>(this, "/api/ack", { requestId: data.requestId });
    if (!result.ok) throw new Error("Chrome chưa xác nhận file đã được lưu");
  },
} satisfies ProviderDefinition<typeof rules>;
