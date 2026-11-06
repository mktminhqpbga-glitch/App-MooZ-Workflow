import XCTest

@testable import MooZCore

final class MediaTests: XCTestCase {
  func testQueueTwoScenesPersistsClipsReopensAndProducesRealFinalMP4() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let tools = try NativeMediaTools()
    let store = try WorkspaceStore(root: root.appendingPathComponent("workspace"))
    let project = try await store.saveProject(Project(name: "Two scenes"))
    let input = try await store.importAsset(
      data: StorageTests.pixel, name: "product.png", mime: "image/png")
    var clips: [Data] = []
    for color in ["red", "blue"] {
      let file = root.appendingPathComponent(color + ".mp4")
      _ = try await ProcessExecutor.run(
        tools.ffmpeg,
        arguments: [
          "-v", "error", "-f", "lavfi", "-i", "color=c=\(color):s=96x64:r=24:d=1", "-c:v",
          "libx264", "-pix_fmt", "yuv420p", file.path,
        ])
      clips.append(try Data(contentsOf: file))
    }
    var draft = BatchDraft()
    draft.prompts = ["Product @anh1"]
    draft.productSlots = [ProductSlot("anh1")]
    draft.groups = [ProductGroup(name: "Product", assetIDs: [input.id])]
    draft.scenePrompts = ["Red scene", "Blue scene"]
    draft.settings.kind = .video
    draft.binding = TabBinding(provider: "fixture", deviceID: "d", tabID: 1, epoch: "e")
    let jobs = try BatchPlanner.plan(projectID: project.id, draft: draft, assets: [input])
    try await store.enqueue(jobs)
    let provider = FixtureProvider()
    await provider.setItems([GeneratedItem(id: "clip", mime: "video/mp4", data: clips[0])])
    let queue = GenerationQueue(store: store, providers: ["fixture": provider], assembler: tools)
    await queue.setEnabled(true)
    let now = Date(timeIntervalSince1970: 5000)
    try await queue.tick(now: now)
    try await queue.tick(now: now)
    let first = try await store.job(jobs[0].id)
    XCTAssertEqual(first?.scenes[0].state, .completed)
    try await queue.tick(now: now.addingTimeInterval(9))
    let before = await provider.counts()
    XCTAssertEqual(before.0, 1)
    let reopened = try WorkspaceStore(root: root.appendingPathComponent("workspace"))
    try await reopened.recoverInterrupted()
    let restart = GenerationQueue(
      store: reopened, providers: ["fixture": provider], assembler: tools)
    await restart.setEnabled(true)
    await provider.setItems([GeneratedItem(id: "clip", mime: "video/mp4", data: clips[1])])
    try await restart.tick(now: now.addingTimeInterval(10))
    try await restart.tick(now: now.addingTimeInterval(10))
    try await restart.tick(now: now.addingTimeInterval(10))
    let finalStore = try WorkspaceStore(root: root.appendingPathComponent("workspace"))
    let saved = try await finalStore.job(jobs[0].id)
    let job = try XCTUnwrap(saved)
    XCTAssertEqual(job.state, .completed)
    XCTAssertTrue(job.scenes.allSatisfy { $0.outputIDs.count == 1 })
    let assets = try await finalStore.assets()
    let final = try XCTUnwrap(assets.first { $0.id == job.finalAssetID })
    XCTAssertEqual(assets.filter { $0.origin == .intermediate }.count, 2)
    let original = try await finalStore.data(for: input)
    XCTAssertEqual(original, StorageTests.pixel)
    let file = try await finalStore.fileURL(for: final)
    let metadata = try await tools.inspect(file)
    XCTAssertEqual(metadata.duration, 2, accuracy: 0.08)
    let counts = await provider.counts()
    XCTAssertEqual(counts.0, 2)
    XCTAssertEqual(counts.1, 2)
    do {
      try await tools.validate(
        Data([0, 0, 0, 12]) + Data("ftyp".utf8) + Data(repeating: 0, count: 16), mime: "video/mp4")
      XCTFail("An MP4 header cannot be acknowledged as a real clip")
    } catch {}
  }
  func testAssemblesRealSceneClipsInOrderAndFinishesWithMusicAndCaptions() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let tools = try NativeMediaTools()
    let red = root.appendingPathComponent("red.mp4")
    let blue = root.appendingPathComponent("blue.mp4")
    let music = root.appendingPathComponent("music.wav")
    let voice = root.appendingPathComponent("voice.wav")
    for (file, color) in [(red, "red"), (blue, "blue")] {
      _ = try await ProcessExecutor.run(
        tools.ffmpeg,
        arguments: [
          "-v", "error", "-f", "lavfi", "-i", "color=c=\(color):s=96x64:r=24:d=1", "-c:v",
          "libx264", "-pix_fmt", "yuv420p", file.path,
        ])
    }
    _ = try await ProcessExecutor.run(
      tools.ffmpeg,
      arguments: ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=700:duration=3", music.path])
    _ = try await ProcessExecutor.run(
      tools.ffmpeg,
      arguments: [
        "-v", "error", "-f", "lavfi", "-i", "sine=frequency=1100:duration=0.7", voice.path,
      ])
    let joined = try await tools.assemble([red, blue])
    let metadata = try await tools.inspect(joined)
    XCTAssertEqual(metadata.streams.first(where: { $0.codec_type == "video" })?.codec_name, "h264")
    XCTAssertEqual(metadata.duration, 2, accuracy: 0.08)
    for (time, channel) in [("0.2", 0), ("1.2", 2)] {
      let pixels = try await ProcessExecutor.run(
        tools.ffmpeg,
        arguments: [
          "-v", "error", "-ss", time, "-i", joined.path, "-frames:v", "1", "-f", "rawvideo",
          "-pix_fmt", "rgb24", "pipe:1",
        ])
      XCTAssertGreaterThan(
        Int(pixels[channel]), Int(pixels[channel == 0 ? 2 : 0]) + 100, "Clip order is retained")
    }
    var settings = FinishingSettings()
    settings.start = 0.2
    settings.end = 1.5
    settings.captions = "1\n00:00:00,000 --> 00:00:01,000\nMooZ native\n"
    let finished = try await tools.finish(joined, music: music, voice: voice, settings: settings)
    let final = try await tools.inspect(finished)
    XCTAssertEqual(final.duration, 1.3, accuracy: 0.08)
    XCTAssertTrue(
      final.streams.contains(where: { $0.codec_type == "audio" && $0.codec_name == "aac" }))
    XCTAssertTrue(FileManager.default.fileExists(atPath: red.path))
  }
}
