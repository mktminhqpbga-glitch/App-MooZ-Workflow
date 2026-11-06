import XCTest

@testable import MooZCore

final class DispatchLedgerTests: XCTestCase {
  func testPermissionPersistsBeforeClickAndCannotBeIssuedAgainAfterRestart() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let ledger = try DispatchLedger(directory: root)
    let token = try ledger.register(
      requestID: "a", tab: 17, provider: "chatgpt", device: "device", epoch: "epoch")
    func call(_ ledger: DispatchLedger, _ operation: String, epoch: String = "epoch") -> [String:
      Any]
    {
      ledger.respond(
        requestID: "a", token: token, tab: 17, device: "device", epoch: epoch, operation: operation)
    }
    XCTAssertEqual(call(ledger, "prepare")["ok"] as? Bool, true)
    XCTAssertEqual(call(ledger, "permit")["ok"] as? Bool, true)
    let reopened = try DispatchLedger(directory: root)
    XCTAssertEqual(call(reopened, "permit")["ok"] as? Bool, false)
    XCTAssertEqual(call(reopened, "sent", epoch: "different")["ok"] as? Bool, false)
    XCTAssertEqual(call(reopened, "sent")["ok"] as? Bool, true)
    XCTAssertTrue(try DispatchLedger(directory: root).wasSent("a"))
    XCTAssertThrowsError(
      try reopened.register(
        requestID: "a", tab: 17, provider: "chatgpt", device: "device", epoch: "different"))
  }
  func testTwoTabsCannotPrepareSameProviderConcurrentlyAndBlocksSurviveRestart() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let ledger = try DispatchLedger(directory: root)
    let a = try ledger.register(requestID: "a", tab: 1, provider: "muse", device: "d", epoch: "e")
    let b = try ledger.register(requestID: "b", tab: 2, provider: "muse", device: "d", epoch: "e")
    func call(_ l: DispatchLedger, _ id: String, _ token: String, _ tab: Int, _ operation: String)
      -> [String: Any]
    {
      l.respond(
        requestID: id, token: token, tab: tab, device: "d", epoch: "e", operation: operation)
    }
    XCTAssertEqual(call(ledger, "a", a, 1, "prepare")["ok"] as? Bool, true)
    XCTAssertEqual(call(ledger, "b", b, 2, "prepare")["waiting"] as? Bool, true)
    _ = call(ledger, "a", a, 1, "block")
    try ledger.finish("a")
    let reopened = try DispatchLedger(directory: root)
    XCTAssertEqual(call(reopened, "b", b, 2, "prepare")["ok"] as? Bool, false)
    try reopened.clearBlock(provider: "muse")
    XCTAssertEqual(call(reopened, "b", b, 2, "prepare")["ok"] as? Bool, true)
  }
}
