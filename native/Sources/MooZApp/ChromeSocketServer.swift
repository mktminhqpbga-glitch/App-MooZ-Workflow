#if os(macOS)
  import Foundation
  import Network
  import Security
  import MooZCore

  /// The app hosts its own loopback WebSocket listener. No Node process or WebView is involved.
  actor ChromeSocketServer: ChromeTransport {
    private var listener: NWListener?
    private var clients: [UUID: NWConnection] = [:]
    private var authenticated: UUID?
    private var current = ChromeIdentity(deviceID: "", epoch: "", connected: false)
    private var token = ""
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private var ledger: DispatchLedger?
    private let directory: URL
    private var pairing = ""
    init(directory: URL) { self.directory = directory }
    func start(port: UInt16 = 4175) throws {
      if listener != nil { return }
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      ledger = try DispatchLedger(directory: directory)
      let tokenFile = directory.appendingPathComponent("pairing-token")
      if FileManager.default.fileExists(atPath: tokenFile.path) {
        token = try String(contentsOf: tokenFile, encoding: .utf8)
        guard token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
          throw MooZError.storage("Khóa ghép Chrome không hợp lệ.")
        }
      } else {
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
          throw MooZError.storage("Không tạo được khóa ghép Chrome.")
        }
        token = random.map { String(format: "%02x", $0) }.joined()
        try token.write(to: tokenFile, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
          [.posixPermissions: 0o600], ofItemAtPath: tokenFile.path)
      }
      let options = NWProtocolWebSocket.Options()
      options.autoReplyPing = true
      let parameters = NWParameters.tcp
      parameters.defaultProtocolStack.applicationProtocols.insert(options, at: 0)
      let nwPort = NWEndpoint.Port(rawValue: port)!
      parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: nwPort)
      let listener = try NWListener(using: parameters, on: nwPort)
      listener.newConnectionHandler = { [weak self] connection in
        Task { await self?.accept(connection) }
      }
      listener.stateUpdateHandler = { [weak self] state in
        if case .failed = state { Task { await self?.listenerFailed() } }
      }
      self.listener = listener
      pairing = "workflow-connect://127.0.0.1:\(port)/\(token)"
      listener.start(queue: DispatchQueue(label: "vn.mooz.chrome-listener"))
    }
    private func listenerFailed() {
      listener?.cancel()
      listener = nil
      pairing = ""
      current.connected = false
    }
    func pairingURI() -> String { pairing }
    func identity() -> ChromeIdentity { current }
    private func accept(_ connection: NWConnection) {
      guard clients.count < 4 else {
        connection.cancel()
        return
      }
      let id = UUID()
      clients[id] = connection
      connection.stateUpdateHandler = { [weak self] state in
        if case .failed = state { Task { await self?.disconnected(id) } }
        if case .cancelled = state { Task { await self?.disconnected(id) } }
      }
      connection.start(queue: DispatchQueue(label: "vn.mooz.chrome-\(id)"))
      receive(id)
      Task {
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        if authenticated != id {
          clients[id]?.cancel()
          clients.removeValue(forKey: id)
        }
      }
    }
    private func receive(_ id: UUID) {
      clients[id]?.receiveMessage { [weak self] data, _, _, error in
        Task {
          guard let self else { return }
          if error != nil {
            await self.disconnected(id)
            return
          }
          if let data { await self.ingest(data, from: id) }
          await self.receive(id)
        }
      }
    }
    private func disconnected(_ id: UUID) {
      clients.removeValue(forKey: id)
      guard authenticated == id else { return }
      authenticated = nil
      current.connected = false
      let waiting = pending
      pending.removeAll()
      for continuation in waiting.values {
        continuation.resume(
          throwing: ProviderFailure.uncertain("Chrome mất kết nối; không gửi lại lượt cũ."))
      }
    }
    private func send(_ object: [String: Any], to id: UUID) {
      guard let connection = clients[id],
        let bytes = try? JSONSerialization.data(withJSONObject: object),
        bytes.count <= 128 * 1_024 * 1_024
      else { return }
      let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
      let context = NWConnection.ContentContext(identifier: "mooz-json", metadata: [metadata])
      connection.send(
        content: bytes, contentContext: context, isComplete: true,
        completion: .contentProcessed({ [weak self] error in
          if error != nil { Task { await self?.disconnected(id) } }
        }))
    }
    private func ingest(_ data: Data, from id: UUID) async {
      guard data.count <= (authenticated == id ? 128 * 1_024 * 1_024 : 4096),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let type = object["type"] as? String
      else {
        clients[id]?.cancel()
        return
      }
      if authenticated != id {
        guard authenticated == nil, type == "auth", let supplied = object["token"] as? String,
          constantEqual(supplied, token), object["protocol"] as? Int == 1,
          let device = object["moozDeviceID"] as? String,
          let epoch = object["moozSessionID"] as? String, !device.isEmpty, !epoch.isEmpty
        else {
          clients[id]?.cancel()
          return
        }
        authenticated = id
        current = ChromeIdentity(deviceID: device, epoch: epoch, connected: true)
        send(
          [
            "type": "ready", "protocol": 1, "appVersion": "0.6.0", "resultRecovery": 1,
            "recoveryMs": 90_000, "pendingRequests": Array(pending.keys()),
          ], to: id)
        return
      }
      if type == "ping" {
        send(["type": "pong"], to: id)
        return
      }
      if type == "response", let requestID = object["id"] as? String {
        send(["type": "response-ack", "id": requestID], to: id)
        guard let continuation = pending.removeValue(forKey: requestID) else { return }
        if let error = object["error"] as? String {
          continuation.resume(throwing: MooZError.unavailable(error))
        } else if let result = object["result"],
          let bytes = try? JSONSerialization.data(
            withJSONObject: result, options: [.fragmentsAllowed])
        {
          continuation.resume(returning: bytes)
        } else {
          continuation.resume(throwing: MooZError.invalid("Chrome trả response thiếu dữ liệu."))
        }
      }
      if type == "gate", let callID = object["callId"] as? String,
        let tab = object["tabId"] as? Int, let message = object["message"] as? [String: Any]
      {
        let result = gate(tab: tab, message: message)
        send(["type": "gate-result", "callId": callID, "result": result], to: id)
      }
    }
    private func constantEqual(_ a: String, _ b: String) -> Bool {
      let x = Array(a.utf8)
      let y = Array(b.utf8)
      guard x.count == 64, y.count == 64 else { return false }
      return zip(x, y).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }
    func request(_ operation: String, payload: Data) async throws -> Data {
      guard ["tabs.query", "tabs.get", "tabs.script", "tabs.message"].contains(operation),
        let id = authenticated, current.connected,
        let object = try JSONSerialization.jsonObject(with: payload) as? [String: Any]
      else { throw MooZError.unavailable("Chưa nối Chrome đã ghép.") }
      let requestID = UUID().uuidString
      return try await withCheckedThrowingContinuation { continuation in
        pending[requestID] = continuation
        send(
          ["type": "request", "id": requestID, "operation": operation, "payload": object], to: id)
        Task {
          try? await Task.sleep(nanoseconds: 60_000_000_000)
          self.expire(requestID)
        }
      }
    }
    private func expire(_ id: String) {
      pending.removeValue(forKey: id)?.resume(
        throwing: ProviderFailure.uncertain(
          "Chrome chưa trả lời. Chỉ đối chiếu lại cùng request ID."))
    }
    func register(requestID: String, tabID: Int, provider: String) throws -> String {
      guard let ledger, current.connected else {
        throw MooZError.unavailable("Chrome chưa ghép nối.")
      }
      return try ledger.register(
        requestID: requestID, tab: tabID, provider: provider, device: current.deviceID,
        epoch: current.epoch)
    }
    func wasSent(requestID: String) -> Bool { ledger?.wasSent(requestID) == true }
    func finish(requestID: String) throws {
      guard let ledger else { throw MooZError.storage("Chưa mở sổ điều phối.") }
      try ledger.finish(requestID)
    }
    func clearBlock(provider: String) throws { try ledger?.clearBlock(provider: provider) }
    private func gate(tab: Int, message: [String: Any]) -> [String: Any] {
      guard let requestID = message["requestId"] as? String,
        let token = message["token"] as? String, let operation = message["operation"] as? String,
        let ledger
      else { return ["ok": false, "error": "Thiếu quyền gửi đã lưu."] }
      return ledger.respond(
        requestID: requestID, token: token, tab: tab, device: current.deviceID,
        epoch: current.epoch, operation: operation)
    }
  }
#endif
