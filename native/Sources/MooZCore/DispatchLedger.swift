import Foundation

/// Owned by the socket server actor. Permission is persisted BEFORE the browser may click Send.
/// A used/expired permission is never reissued: ambiguity must be reconciled, not replayed.
public final class DispatchLedger {
  private struct Entry: Codable {
    var tab: Int
    var provider: String
    var device: String
    var epoch: String
    var token: String
    var prepared = false
    var permissionIssued = false
    var sent = false
  }
  private struct Snapshot: Codable {
    var entries: [String: Entry] = [:]
    var lastSent: [String: Date] = [:]
    var blocks: Set<String> = []
  }
  private let file: URL
  private var state: Snapshot
  public init(directory: URL) throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    file = directory.appendingPathComponent("dispatch-ledger.json")
    state =
      FileManager.default.fileExists(atPath: file.path)
      ? try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: file)) : Snapshot()
  }
  public func register(requestID: String, tab: Int, provider: String, device: String, epoch: String)
    throws -> String
  {
    if let old = state.entries[requestID] {
      guard old.tab == tab, old.provider == provider, old.device == device, old.epoch == epoch
      else { throw MooZError.invalid("Lượt gửi đã thuộc thiết bị/phiên/tab khác.") }
      return old.token
    }
    var next = state
    let token = UUID().uuidString
    next.entries[requestID] = Entry(
      tab: tab, provider: provider, device: device, epoch: epoch, token: token)
    try commit(next)
    return token
  }
  public func wasSent(_ requestID: String) -> Bool { state.entries[requestID]?.sent == true }
  public func finish(_ requestID: String) throws {
    var next = state
    next.entries.removeValue(forKey: requestID)
    try commit(next)
  }
  public func respond(
    requestID: String, token: String, tab: Int, device: String, epoch: String, operation: String,
    now: Date = Date()
  ) -> [String: Any] {
    guard var entry = state.entries[requestID], entry.token == token, entry.tab == tab,
      entry.device == device, entry.epoch == epoch
    else { return denied("Quyền gửi không đúng thiết bị/phiên/tab/lượt.") }
    var next = state
    do {
      if operation == "block" {
        next.blocks.insert(entry.provider)
        try commit(next)
        return denied("Dịch vụ AI đang chặn. Kiểm tra trực tiếp trước khi mở lại quyền gửi.")
      }
      if operation == "sent" {
        guard entry.permissionIssued else { return denied("Chưa cấp quyền gửi.") }
        // Repeated receipt delivery is idempotent; it cannot authorise a new click.
        if entry.sent { return ["ok": true] }
        entry.sent = true
        next.entries[requestID] = entry
        next.lastSent[entry.provider] = now
        try commit(next)
        return ["ok": true]
      }
      if operation == "cancel" { return ["ok": true] }  // Never infer that an attempted Send did not happen.
      guard !state.blocks.contains(entry.provider) else {
        return denied("Cần xác nhận dịch vụ AI đã sẵn sàng trở lại.")
      }
      guard !entry.permissionIssued else {
        return denied("Quyền gửi đã dùng hoặc hết hạn. Chỉ đối chiếu, không gửi lại.")
      }
      let occupied = state.entries.contains { key, other in
        key != requestID && other.provider == entry.provider
          && (other.prepared || other.permissionIssued || other.sent)
      }
      if occupied { return ["ok": true, "waiting": true, "waitMs": 1000] }
      switch operation {
      case "prepare":
        entry.prepared = true
        next.entries[requestID] = entry
        try commit(next)
        return ["ok": true]
      case "permit":
        guard entry.prepared else { return denied("Phải chuẩn bị đúng lượt trước khi gửi.") }
        if let sent = state.lastSent[entry.provider], sent.addingTimeInterval(5) > now {
          return ["ok": true, "waiting": true, "waitMs": 1000]
        }
        entry.permissionIssued = true
        next.entries[requestID] = entry
        try commit(next)
        return ["ok": true, "expiresAt": now.addingTimeInterval(2).timeIntervalSince1970 * 1000]
      default: return denied("Thao tác điều phối không hợp lệ.")
      }
    } catch { return denied("Không lưu được quyền gửi. Dừng để tránh gửi trùng.") }
  }
  public func clearBlock(provider: String) throws {
    var next = state
    next.blocks.remove(provider)
    try commit(next)
  }
  private func denied(_ message: String) -> [String: Any] { ["ok": false, "error": message] }
  private func commit(_ next: Snapshot) throws {
    try JSONEncoder().encode(next).write(to: file, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    let handle = try FileHandle(forWritingTo: file)
    try handle.synchronize()
    try handle.close()
    state = next
  }
}
