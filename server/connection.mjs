import { ChromeRelay } from "../vendor/mooz/desktop/chrome-relay.cjs";
import { OutboundRelay } from "../vendor/mooz/desktop/outbound-relay.cjs";
import { AIDispatch } from "../vendor/mooz/desktop/ai-dispatch.cjs";
import sites from "../vendor/mooz/ai-sites.js";
import protocol from "../vendor/mooz/chrome-remote-protocol.js";
export class ChromeConnection {
  constructor(directory, env = process.env) {
    this.env = env;
    this.relay = new ChromeRelay({ version: "0.69.0" });
    this.dispatch = new AIDispatch(directory);
    this.relay.dispatch = this.dispatch;
    this.broker = new OutboundRelay({ relay: this.relay });
  }
  async init() {
    await this.dispatch.init();
  }
  status() {
    return {
      ...this.relay.status(),
      broker: this.broker.status(),
      remoteConfigured: !!(this.env.MOOZ_RELAY_URL && this.env.MOOZ_RELAY_KEY),
    };
  }
  async pair() {
    if (this.relay.isConnected || this.relay.recovery)
      throw Error("Đã có phiên Chrome. Ngắt phiên cũ trước khi ghép mới.");
    await this.relay.start();
    if (this.env.MOOZ_RELAY_URL) {
      if (!this.env.MOOZ_RELAY_KEY)
        throw Error("Thiếu MOOZ_RELAY_KEY trên máy chủ.");
      await this.relay.startRemoteIngress();
      if (!this.broker.ready)
        await this.broker.start(
          this.env.MOOZ_RELAY_URL,
          this.env.MOOZ_RELAY_KEY,
        );
      this.relay.configureRemote(this.env.MOOZ_RELAY_URL);
      const room = await this.broker.newRoom(),
        pair = this.relay.remotePairingURI(),
        expiresAt = Math.min(room.expiresAt, pair.expiresAt);
      return {
        uri: protocol.relayPairing(this.env.MOOZ_RELAY_URL, {
          ...room,
          token: this.relay.remoteLease.token,
          expiresAt,
        }),
        expiresAt,
        mode: "remote",
      };
    }
    return {
      uri: this.relay.pairingURI(),
      mode: "local",
      note: "Chrome phải chạy cùng máy với máy chủ Node. Máy chủ cloud cần relay WSS.",
    };
  }
  async tabs(provider) {
    if (!this.relay.isConnected) return [];
    return (await this.relay.rawRequest("tabs.query", {}))
      .filter((t) => sites.providerForURL(t.url) === provider)
      .map((t) => ({ id: t.id, title: t.title, url: t.url }));
  }
  async check(input) {
    const tab = await this.relay.rawRequest("tabs.get", { id: input.tabId });
    if (sites.providerForURL(tab.url) !== input.provider)
      throw Error("Tab không thuộc AI đã chọn.");
    if (input.chatURL && tab.url !== input.chatURL)
      throw Error("Cuộc trò chuyện đã thay đổi; chưa gửi yêu cầu.");
    const files = [
      "ai-activity.js",
      "composer-controls.js",
      input.provider === "muse" ? "muse-bridge.js" : "ai-bridge.js",
    ];
    await this.relay.rawRequest("tabs.script", { id: tab.id, files });
    const check = await this.relay.rawRequest("tabs.message", {
      id: tab.id,
      message: {
        type:
          input.provider === "muse"
            ? "MUSEFLOW_CHECK_SESSION"
            : "WORKFLOW_AI_CHECK",
      },
    });
    if (!check?.ok || !check.composer || check.signedIn === false)
      throw Error(check?.error || "Tab chưa đăng nhập hoặc chưa sẵn sàng.");
    if (check.busy)
      throw Object.assign(Error("Tab đang bận; tác vụ chưa được gửi."), {
        code: "TAB_BUSY",
      });
    if (check.sendProtocol !== 1)
      throw Error("Cập nhật MooZ Connect rồi tải lại tab AI.");
    return tab;
  }
  async generate(input) {
    const request = {
      type:
        input.provider === "muse"
          ? "MUSEFLOW_GENERATE"
          : "WORKFLOW_AI_GENERATE",
      requestId: input.requestId,
      provider: input.provider,
      mediaType: input.mediaType,
      prompt: input.prompt,
      referenceImages: input.referenceImages || [],
      size: input.size,
      duration: input.duration,
      chatTarget: { tabId: input.tabId, url: input.chatURL },
    };
    const result = await this.relay.request("tabs.message", {
      id: input.tabId,
      message: request,
    });
    if (result?.requestId && result.requestId !== input.requestId)
      throw Error("Mã kết quả không khớp lượt gửi.");
    if (!result?.ok) throw Error(result?.error || "AI chưa trả kết quả.");
    const latest = await this.relay.rawRequest("tabs.get", { id: input.tabId });
    if (latest.url !== input.chatURL)
      throw Error(
        "Tab đã đổi cuộc trò chuyện. Kiểm tra kết quả thủ công; không tự gửi lại.",
      );
    if (
      input.mediaType === "text" &&
      typeof result.text === "string" &&
      result.text.trim()
    )
      return { kind: "text", text: result.text };
    if (
      typeof result.url !== "string" ||
      !new RegExp("^data:" + input.mediaType + "/").test(result.url)
    )
      throw Error(
        "Kết quả chưa có media nhúng hợp lệ. Kiểm tra tab và tải tệp về Kho.",
      );
    return { kind: input.mediaType, url: result.url };
  }
  async close() {
    await this.broker.stop();
    await this.relay.close();
  }
}
