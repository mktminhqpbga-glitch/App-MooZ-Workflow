import XCTest

@testable import MooZCore

final class StorageTests: XCTestCase {
  func testCompletedHistoryDoesNotConsumeActiveQueueCapacity() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try WorkspaceStore(root: root)
    let project = try await store.saveProject(Project(name: "History"))
    var draft = BatchDraft()
    draft.prompts = ["Old"]
    var old = try BatchPlanner.plan(projectID: project.id, draft: draft, assets: [])[0]
    try await store.enqueue([old])
    let output = try await store.importAsset(
      data: Self.pixel, name: "old-result.png", mime: "image/png", origin: .result,
      requestID: old.scenes[0].requestID, itemID: "image")
    old.state = .completed
    old.scenes[0].state = .completed
    old.scenes[0].outputIDs = [output.id]
    old.scenes[0].expectedItems = 1
    old.finalAssetID = output.id
    try await store.updateJob(old)
    let count = try await store.activeJobCount()
    XCTAssertEqual(count, 0)
    draft.prompts = (1...20).map { "New \($0)" }
    draft.copies = 10
    let batch = try BatchPlanner.plan(
      projectID: project.id, draft: draft, assets: [], existingJobs: count)
    try await store.enqueue(batch)
    let active = try await store.jobs(activeOnly: true)
    let history = try await store.jobs()
    XCTAssertEqual(active.count, 200)
    XCTAssertEqual(history.count, 201)
  }
  func testSHA256KnownVectors() {
    XCTAssertEqual(
      ContentHash.sha256(Data()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
    XCTAssertEqual(
      ContentHash.sha256(Data("abc".utf8)),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    XCTAssertEqual(
      ContentHash.sha256(Data(repeating: 97, count: 1_000_000)),
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
  }
  func testAtomicEnqueueSnapshotProtectionAndCrossConnectionClaim() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let first = try WorkspaceStore(root: root)
    let project = try await first.saveProject(Project(name: "Snapshot"))
    var draft = BatchDraft()
    draft.prompts = ["Create"]
    draft.copies = 2
    let jobs = try BatchPlanner.plan(projectID: project.id, draft: draft, assets: [])
    var wrong = jobs[1]
    wrong.projectID = "absent"
    do {
      try await first.enqueue([jobs[0], wrong])
      XCTFail("Whole batch must roll back")
    } catch {}
    let empty = try await first.jobs()
    XCTAssertTrue(empty.isEmpty)
    try await first.enqueue(jobs)
    var changed = jobs[0]
    changed.settings.model = "other"
    do {
      try await first.updateJob(changed)
      XCTFail("Model snapshot changed")
    } catch {}
    let second = try WorkspaceStore(root: root)
    let now = Date()
    let one = try await first.claim(jobID: jobs[0].id, sceneIndex: 0, now: now)
    let two = try await second.claim(jobID: jobs[1].id, sceneIndex: 0, now: now)
    XCTAssertNotNil(one)
    XCTAssertNil(two)
    let same = try await second.claim(jobID: jobs[0].id, sceneIndex: 0, now: now)
    XCTAssertNil(same)
  }
  func testOptimisticRevisionAndCorruptOriginalAreRejected() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try WorkspaceStore(root: root)
    let saved = try await store.saveProject(Project(name: "First"))
    var edited = saved
    edited.name = "Second"
    _ = try await store.saveProject(edited)
    do {
      _ = try await store.saveProject(saved)
      XCTFail("Stale project must not overwrite newer edits")
    } catch {}
    let image = try await store.importAsset(
      data: Self.pixel, name: "original.png", mime: "image/png")
    let file = try await store.fileURL(for: image)
    try Data("corrupt".utf8).write(to: file)
    do {
      _ = try await store.data(for: image)
      XCTFail("Corruption must be detected before claiming success")
    } catch {}
  }
  static let pixel = Data(
    base64Encoded:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="
  )!
  func testTruncatedImageHeaderIsNotAnAsset() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try WorkspaceStore(root: root)
    do {
      _ = try await store.importAsset(
        data: Self.pixel.prefix(24), name: "broken.png", mime: "image/png")
      XCTFail("A header is not a decodable image")
    } catch {}
    let assets = try await store.assets()
    XCTAssertTrue(assets.isEmpty)
  }
  func testProjectAndOriginalFileSurviveReopen() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let first = try WorkspaceStore(root: root)
    var project = Project(name: "Sản phẩm A")
    project.draft.prompts = ["Giữ nhãn sản phẩm"]
    project.draft.productMode = "manual"
    project.draft.pendingProductIDs = ["unassigned"]
    var finishing = FinishingSettings()
    finishing.clipIDs = ["clip-2", "clip-1"]
    finishing.musicAssetID = "music"
    project.finishing = finishing
    let saved = try await first.saveProject(project)
    let input = try await first.importAsset(
      data: Self.pixel, name: "original.png", mime: "image/png")
    let reopened = try WorkspaceStore(root: root)
    let projects = try await reopened.projects()
    let bytes = try await reopened.data(for: input)
    let assets = try await reopened.assets()
    XCTAssertEqual(projects.first?.id, saved.id)
    XCTAssertEqual(projects.first?.draft.prompts, ["Giữ nhãn sản phẩm"])
    XCTAssertEqual(projects.first?.draft.pendingProductIDs, ["unassigned"])
    XCTAssertEqual(projects.first?.finishing?.clipIDs, ["clip-2", "clip-1"])
    XCTAssertEqual(projects.first?.finishing?.musicAssetID, "music")
    XCTAssertEqual(bytes, Self.pixel)
    XCTAssertEqual(assets.count, 1)
  }
}
