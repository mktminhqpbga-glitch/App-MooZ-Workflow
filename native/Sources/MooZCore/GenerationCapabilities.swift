import Foundation

/// Offline preflight must reject an impossible provider/type or an unselected Chrome tab.
public enum GenerationCapabilities {
  public static func validate(_ draft: BatchDraft) throws {
    let provider = draft.binding.provider
    let types: [String: Set<MediaKind>] = [
      "openai": [.image, .text], "google": [.image, .video, .text], "fal": [.video],
      "muse": [.image, .video, .text], "chatgpt": [.image, .text], "gemini": [.image, .text],
      "grok": [.image, .video, .text], "flow": [.image, .video],
    ]
    if let supported = types[provider], !supported.contains(draft.settings.kind) {
      throw MooZError.invalid(
        "\(provider) không hỗ trợ loại đầu ra \(draft.settings.kind.rawValue) qua bộ nối này. Chọn lại AI trước khi tạo tác vụ."
      )
    }
    if ["muse", "chatgpt", "gemini", "grok", "flow"].contains(provider) {
      guard let tab = draft.binding.tabID, tab >= 0, !draft.binding.deviceID.isEmpty,
        !draft.binding.epoch.isEmpty,
        let url = draft.binding.conversationURL, ConversationIdentity.provider(url) == provider
      else {
        throw MooZError.invalid("Chọn tab Chrome cố định đã ghép nối trước khi xem kế hoạch.")
      }
    }
  }
}
