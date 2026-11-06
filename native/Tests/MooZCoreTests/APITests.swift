import XCTest

@testable import MooZCore

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

private actor HTTPFixture: HTTPTransport {
  var requests: [URLRequest] = []
  var replies: [HTTPResult]
  init(_ values: [HTTPResult]) { replies = values }
  func send(_ request: URLRequest) async throws -> HTTPResult {
    requests.append(request)
    guard !replies.isEmpty else { throw MooZError.unavailable("Unexpected HTTP") }
    return replies.removeFirst()
  }
  func recorded() -> [URLRequest] { requests }
}
final class APITests: XCTestCase {
  private func response(_ value: [String: Any], status: Int = 200) throws -> HTTPResult {
    HTTPResult(status: status, data: try JSONSerialization.data(withJSONObject: value))
  }
  private func request(
    provider: String = "openai", kind: MediaKind = .image, inputs: [(Asset, Data)] = []
  ) throws -> ProviderRequest {
    var draft = BatchDraft()
    draft.prompts = ["Tạo sản phẩm"]
    draft.binding = TabBinding(provider: provider)
    draft.settings.kind = kind
    if provider == "google" {
      draft.settings.model = "veo-3.1-generate-preview"
      draft.settings.ratio = "16:9"
      draft.settings.resolution = "720P"
    }
    let job = try BatchPlanner.plan(projectID: "p", draft: draft, assets: [])[0]
    return ProviderRequest(job: job, scene: job.scenes[0], inputs: inputs)
  }
  func testOpenAIReturnsAllImagesAndSendsImmutableNonceOnce() async throws {
    let transport = HTTPFixture([
      try response([
        "data": [
          ["b64_json": StorageTests.pixel.base64EncodedString()],
          ["b64_json": StorageTests.pixel.base64EncodedString()],
        ]
      ])
    ])
    let api = APIProvider(service: .openai, transport: transport, key: { "fixture-key" })
    let req = try request()
    let receipt = try await api.submit(req)
    guard case .output(let items, let expected, let finished) = receipt.initial else {
      return XCTFail("Missing synchronous output")
    }
    XCTAssertEqual(items.count, 2)
    XCTAssertEqual(expected, 2)
    XCTAssertTrue(finished)
    let requests = await transport.recorded()
    XCTAssertEqual(requests.count, 1)
    let body = try JSONSerialization.jsonObject(with: requests[0].httpBody!) as! [String: Any]
    XCTAssertEqual(body["prompt"] as? String, req.scene.wirePrompt(kind: .image))
    XCTAssertEqual(requests[0].url?.host, "api.openai.com")
    _ = try await api.status(req)
    try await api.acknowledge(req)
    if case .missing = try await api.status(req) {
    } else {
      XCTFail("ACK must release buffered output")
    }
    let final = await transport.recorded()
    XCTAssertEqual(final.count, 1)
  }
  func testMultipartRetainsEveryReferenceAndSafeFilenames() async throws {
    let transport = HTTPFixture([
      try response(["data": [["b64_json": StorageTests.pixel.base64EncodedString()]]])
    ])
    let api = APIProvider(service: .openai, transport: transport, key: { "fixture-key" })
    let refs = [Asset(name: "a\r\n.png"), Asset(name: "b.png")].map { ($0, StorageTests.pixel) }
    _ = try await api.submit(request(inputs: refs))
    let sent = await transport.recorded()
    let body = String(decoding: sent[0].httpBody!, as: UTF8.self)
    XCTAssertEqual(body.components(separatedBy: "name=\"image[]\"").count - 1, 2)
    XCTAssertTrue(body.contains("reference-1.png"))
    XCTAssertTrue(body.contains("reference-2.png"))
    XCTAssertFalse(body.contains("a\r\n.png"))
    XCTAssertEqual(sent[0].url?.path, "/v1/images/edits")
  }
  func testVeoOperationCanBePolledByNewAdapterWithoutAnotherPost() async throws {
    let transport = HTTPFixture([
      try response(["name": "models/veo-3.1-generate-preview/operations/one"]),
      try response(["done": false]),
    ])
    let req = try request(provider: "google", kind: .video)
    let first = APIProvider(service: .google, transport: transport, key: { "fixture-key" })
    let receipt = try await first.submit(req)
    var job = req.job
    job.scenes[0].receipt = receipt.token
    let reopened = APIProvider(service: .google, transport: transport, key: { "fixture-key" })
    if case .running = try await reopened.status(
      ProviderRequest(job: job, scene: job.scenes[0], inputs: []))
    {
    } else {
      XCTFail("Expected durable operation reconciliation")
    }
    let calls = await transport.recorded()
    XCTAssertEqual(calls.map(\.httpMethod), ["POST", "GET"])
    XCTAssertTrue(calls.allSatisfy { $0.url?.host == "generativelanguage.googleapis.com" })
  }
  func testRejectedPostIsNotRepeatedByQueue() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try WorkspaceStore(root: root)
    let project = try await store.saveProject(Project(name: "API"))
    var draft = BatchDraft()
    draft.prompts = ["Image"]
    let jobs = try BatchPlanner.plan(projectID: project.id, draft: draft, assets: [])
    try await store.enqueue(jobs)
    let transport = HTTPFixture([try response(["error": "fixture"], status: 429)])
    let api = APIProvider(service: .openai, transport: transport, key: { "fixture-key" })
    let queue = GenerationQueue(store: store, providers: ["openai": api])
    await queue.setEnabled(true)
    try await queue.tick()
    try await queue.tick()
    try await queue.tick()
    let saved = try await store.job(jobs[0].id)
    XCTAssertEqual(saved?.state, .failed)
    let calls = await transport.recorded()
    XCTAssertEqual(calls.count, 1)
  }
}
