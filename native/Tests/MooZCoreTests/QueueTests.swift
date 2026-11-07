import XCTest

@testable import MooZCore

actor FixtureProvider: GenerationProvider {
  var busy = false
  var submissions: [String] = []
  var acknowledgements: [String] = []
  var failSubmit = false
  var output = StorageTests.pixel
  var items: [GeneratedItem]?
  var ackFailures = 0
  var ackDelay: UInt64 = 0
  var lastAck: Date?
  func delayAcknowledgement(_ nanoseconds: UInt64) { ackDelay = nanoseconds }
  func acknowledgedTime() -> Date? { lastAck }
  func setItems(_ value: [GeneratedItem]) { items = value }
  func failNextAcknowledgement() { ackFailures = 1 }
  func setBusy(_ value: Bool) { busy = value }
  func setFailSubmit(_ value: Bool) { failSubmit = value }
  func health(_ binding: TabBinding) async throws -> ProviderHealth { busy ? .busy : .ready }
  func submit(_ request: ProviderRequest) async throws -> SubmissionReceipt {
    submissions.append(request.scene.requestID)
    if failSubmit { throw ProviderFailure.uncertain("fixture lost response") }
    return SubmissionReceipt(token: request.scene.requestID)
  }
  func status(_ request: ProviderRequest) async throws -> ProviderPoll {
    .output(
      items: items ?? [GeneratedItem(id: "image-1", mime: "image/png", data: output)],
      expected: items?.count ?? 1, finished: true)
  }
  func acknowledge(_ request: ProviderRequest) async throws {
    if ackDelay > 0 { try await Task.sleep(nanoseconds: ackDelay) }
    if ackFailures > 0 {
      ackFailures -= 1
      throw MooZError.unavailable("fixture lost ACK response")
    }
    acknowledgements.append(request.scene.requestID)
    lastAck = Date()
  }
  func counts() -> (Int, Int) { (submissions.count, acknowledgements.count) }
}

final class QueueTests: XCTestCase {
  func testProductionCooldownStartsAfterSlowAcknowledgementRatherThanTickStart() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try WorkspaceStore(root: root)
    let provider = FixtureProvider()
    let jobs = try await makeJobs(store, copies: 1)
    let queue = GenerationQueue(store: store, providers: ["fixture": provider])
    await queue.setEnabled(true)
    await provider.delayAcknowledgement(200_000_000)
    try await queue.tick()
    try await queue.tick()
    let actualAck = await provider.acknowledgedTime()
    let until = try await store.cooldownUntil(jobs[0].binding.resource)
    let ack = try XCTUnwrap(actualAck)
    let cooldown = try XCTUnwrap(until)
    XCTAssertGreaterThanOrEqual(cooldown.timeIntervalSince(ack), 9.99)
  }
  func testPartialSurvivesRestartAndLostAckRetriesOnlyAck() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try WorkspaceStore(root: root)
    let provider = FixtureProvider()
    let jobs = try await makeJobs(store, copies: 1)
    let queue = GenerationQueue(store: store, providers: ["fixture": provider])
    await queue.setEnabled(true)
    let good = GeneratedItem(id: "one", mime: "image/png", data: StorageTests.pixel)
    await provider.setItems([
      good,
      GeneratedItem(id: "two", mime: "image/png", data: Data("<html>not an image</html>".utf8)),
    ])
    let now = Date(timeIntervalSince1970: 2_000)
    try await queue.tick(now: now)
    try await queue.tick(now: now)
    let partial = try await store.job(jobs[0].id)
    XCTAssertEqual(partial?.state, .partial)
    XCTAssertEqual(partial?.scenes[0].outputIDs.count, 1)
    let counts = await provider.counts()
    XCTAssertEqual(counts.0, 1)
    XCTAssertEqual(counts.1, 0)
    let reopened = try WorkspaceStore(root: root)
    try await reopened.recoverInterrupted()
    let restart = GenerationQueue(store: reopened, providers: ["fixture": provider])
    await provider.setItems([
      good, GeneratedItem(id: "two", mime: "image/png", data: StorageTests.pixel),
    ])
    await provider.failNextAcknowledgement()
    try await restart.tick(now: now)
    let persisted = try await reopened.job(jobs[0].id)
    XCTAssertEqual(persisted?.scenes[0].state, .persisted)
    XCTAssertEqual(persisted?.scenes[0].outputIDs.count, 2)
    try await restart.tick(now: now)
    let complete = try await reopened.job(jobs[0].id)
    XCTAssertEqual(complete?.state, .completed)
    let final = await provider.counts()
    XCTAssertEqual(final.0, 1)
    XCTAssertEqual(final.1, 1)
    let assets = try await reopened.assets()
    XCTAssertEqual(assets.count, 2)
  }
  func testLostSubmitResponseReconcilesWithoutAnotherSubmission() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try WorkspaceStore(root: root)
    let provider = FixtureProvider()
    let jobs = try await makeJobs(store, copies: 1)
    await provider.setFailSubmit(true)
    let queue = GenerationQueue(store: store, providers: ["fixture": provider])
    await queue.setEnabled(true)
    try await queue.tick()
    let uncertain = try await store.job(jobs[0].id)
    XCTAssertEqual(uncertain?.state, .unknown)
    let reopened = try WorkspaceStore(root: root)
    try await reopened.recoverInterrupted()
    let restart = GenerationQueue(store: reopened, providers: ["fixture": provider])
    await restart.setEnabled(true)
    try await restart.tick()
    let result = try await reopened.job(jobs[0].id)
    XCTAssertEqual(result?.state, .completed)
    let counts = await provider.counts()
    XCTAssertEqual(counts.0, 1)
  }
  func makeJobs(_ store: WorkspaceStore, copies: Int = 2) async throws -> [Job] {
    let project = try await store.saveProject(Project(name: "Queue"))
    var draft = BatchDraft()
    draft.prompts = ["Tạo ảnh thử nghiệm"]
    draft.copies = copies
    draft.binding = TabBinding(
      provider: "fixture", deviceID: "chrome-one", tabID: 17, epoch: "epoch-one",
      conversationURL: "https://muse.ai/new")
    let jobs = try BatchPlanner.plan(projectID: project.id, draft: draft, assets: [])
    try await store.enqueue(jobs)
    return jobs
  }
  func testBusyWaitsThenPersistedAckStartsTenSecondCooldown() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try WorkspaceStore(root: root)
    let provider = FixtureProvider()
    let jobs = try await makeJobs(store)
    let queue = GenerationQueue(store: store, providers: ["fixture": provider])
    await queue.setEnabled(true)
    await provider.setBusy(true)
    let time = Date(timeIntervalSince1970: 1_000)
    try await queue.tick(now: time)
    let waiting = try await store.job(jobs[0].id)
    XCTAssertEqual(waiting?.state, .waitingTab)
    let before = await provider.counts()
    XCTAssertEqual(before.0, 0)
    await provider.setBusy(false)
    try await queue.tick(now: time)
    try await queue.tick(now: time)
    let first = try await store.job(jobs[0].id)
    XCTAssertEqual(first?.state, .completed)
    let saved = try await store.assets()
    XCTAssertEqual(saved.count, 1)
    let counts = await provider.counts()
    XCTAssertEqual(counts.0, 1)
    XCTAssertEqual(counts.1, 1)
    let reopened = try WorkspaceStore(root: root)
    let newQueue = GenerationQueue(store: reopened, providers: ["fixture": provider])
    await newQueue.setEnabled(true)
    try await newQueue.tick(now: time.addingTimeInterval(9.999))
    let during = await provider.counts()
    XCTAssertEqual(during.0, 1)
    try await newQueue.tick(now: time.addingTimeInterval(10))
    let after = await provider.counts()
    XCTAssertEqual(after.0, 2)
  }
}
