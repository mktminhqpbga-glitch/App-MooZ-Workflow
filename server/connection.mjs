import { ChromeRelay } from "../vendor/mooz/desktop/chrome-relay.cjs";
import { OutboundRelay } from "../vendor/mooz/desktop/outbound-relay.cjs";
import { AIDispatch } from "../vendor/mooz/desktop/ai-dispatch.cjs";
import sites from "../vendor/mooz/ai-sites.js";
import protocol from "../vendor/mooz/chrome-remote-protocol.js";
import { RelaySettings } from "./relay-settings.mjs";
export class ChromeConnection {
  constructor(directory, env = process.env, { brokerOptions = {} } = {}) {
    this.settings = new RelaySettings(directory, env);
    this.brokerOptions = brokerOptions;
    this.testProbes = new Set();
    this.relay = new ChromeRelay({ version: "0.69.0" });
    this.dispatch = new AIDispatch(directory);
    this.relay.dispatch = this.dispatch;
    this.broker = new OutboundRelay({ relay: this.relay, ...brokerOptions });
  }
  async init() {
    await this.dispatch.init();
    await this.settings.init();
  }
  status() {
    return {
      ...this.relay.status(),
      broker: this.broker.status(),
      remoteConfigured: this.settings.current.mode === "relay",
    };
  }
  async disconnect() {
    this.relay.revokeLocal(); this.relay.revokeRemote(); await this.broker.stop();
  }
  async configure(input) {
    const next=this.settings.resolve(input);
    const changed=JSON.stringify(next)!==JSON.stringify(this.settings.current);
    const state=await this.settings.save(next);
    if(changed){await this.disconnect();if(next.mode==='local')this.relay.configureRemote(null);}
    return {...state,disconnected:changed};
  }
  async testRelay(input) {
    const config=this.settings.resolve(input);
    if(config.mode!=='relay')throw Error('Chọn relay máy ảo để kiểm tra kết nối từ xa.');
    const probe=new OutboundRelay({relay:this.relay,...this.brokerOptions});
    this.testProbes.add(probe);
    try { await probe.start(config.endpoint,config.key);return {ok:true,endpoint:config.endpoint,message:'Đã xác thực relay qua HTTPS/WSS. Chrome máy ảo vẫn cần ghép bằng mã.'}; }
    finally { await probe.stop();this.testProbes.delete(probe); }
  }
  async pair() {
    if(this.settings.loadError)throw Error(this.settings.loadError);
    if (this.relay.isConnected || this.relay.recovery)
      throw Error("Đã có phiên Chrome. Ngắt phiên cũ trước khi ghép mới.");
    await this.relay.start();
    const {mode,endpoint,key}=this.settings.current;
    if (mode === "relay") {
      if (!key)
        throw Error("Thiếu MOOZ_RELAY_KEY trên máy chủ.");
      await this.relay.startRemoteIngress();
      if (!this.broker.ready)
        await this.broker.start(
          endpoint,
          key,
        );
      this.relay.configureRemote(endpoint);
      const room = await this.broker.newRoom(),
        pair = this.relay.remotePairingURI(),
        expiresAt = Math.min(room.expiresAt, pair.expiresAt);
      return {
        uri: protocol.relayPairing(endpoint, {
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
    await Promise.all([...this.testProbes].map(probe=>probe.stop()));
    await this.broker.stop();
    await this.relay.close();
  }
}
