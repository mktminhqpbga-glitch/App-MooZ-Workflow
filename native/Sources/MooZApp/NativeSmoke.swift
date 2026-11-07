#if os(macOS)
  import AppKit
  import MooZCore

  private actor SmokeVideoProvider: GenerationProvider {
    let clips: [Data]
    var sent: [Date] = []
    var acknowledgements = 0
    init(clips: [Data]) { self.clips = clips }
    func health(_ binding: TabBinding) async throws -> ProviderHealth { .ready }
    func submit(_ request: ProviderRequest) async throws -> SubmissionReceipt {
      sent.append(Date())
      return SubmissionReceipt(token: request.scene.requestID)
    }
    func status(_ request: ProviderRequest) async throws -> ProviderPoll {
      .output(
        items: [GeneratedItem(id: "clip", mime: "video/mp4", data: clips[request.scene.index - 1])],
        expected: 1, finished: true)
    }
    func acknowledge(_ request: ProviderRequest) async throws { acknowledgements += 1 }
    func evidence() -> ([Date], Int) { (sent, acknowledgements) }
  }

  /// Launch verification uses generated files and a fixture provider. It does not call an AI account.
  @MainActor enum NativeSmoke {
    static func run(_ model: WorkspaceModel) async {
      do {
        for _ in 0..<100 where !model.ready {
          if let error = model.error { throw MooZError.unavailable(error) }
          try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard model.ready, let media = model.media else {
          throw MooZError.unavailable("Native startup/media unavailable")
        }
        guard model.root.lastPathComponent.hasPrefix("mooz-smoke-"),
          try await model.store.jobs().isEmpty
        else { throw MooZError.invalid("Smoke tests require a fresh isolated workspace") }
        let output =
          ProcessInfo.processInfo.environment["MOOZ_SMOKE_OUTPUT"].map {
            URL(fileURLWithPath: $0, isDirectory: true)
          }
          ?? model.root.appendingPathComponent("smoke", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let fixtures = model.root.appendingPathComponent("smoke-fixtures", isDirectory: true)
        try FileManager.default.createDirectory(at: fixtures, withIntermediateDirectories: true)
        var images: [URL] = []
        var clips: [Data] = []
        for color in ["red", "blue", "green"] {
          let image = fixtures.appendingPathComponent(color + ".png")
          _ = try await ProcessExecutor.run(
            media.ffmpeg,
            arguments: [
              "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=\(color):s=96x64", "-frames:v",
              "1", image.path,
            ])
          images.append(image)
        }
        for color in ["red", "blue"] {
          let clip = fixtures.appendingPathComponent(color + ".mp4")
          _ = try await ProcessExecutor.run(
            media.ffmpeg,
            arguments: [
              "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=\(color):s=96x64:r=24:d=1", "-c:v",
              "libx264", "-pix_fmt", "yuv420p", clip.path,
            ])
          clips.append(try Data(contentsOf: clip))
        }
        await model.createProject("Native smoke · fixture")
        await model.importURLs(images)
        guard model.productIDs.count == 3 else {
          throw MooZError.invalid("Native file import failed")
        }
        model.groupMode = .combined
        let tokens = model.productIDs.map { model.referenceToken($0) }
        guard Set(tokens).count == 3 else {
          throw MooZError.invalid("Dragging different product angles reused one alias")
        }
        model.groupMode = .separate
        let fixture = SmokeVideoProvider(clips: clips)
        await model.queue.register(fixture, id: "fixture")
        model.draft.binding = TabBinding(
          provider: "fixture", deviceID: "fixture", tabID: 42, epoch: "fixture")
        model.draft.settings = GenerationSettings(kind: .video, model: "fixture")
        model.draft.copies = 2
        model.promptText = "Tạo video cho @" + model.productAlias()
        model.sceneText = "Cảnh đỏ\n---\nCảnh xanh"
        await model.plan()
        guard model.preview.count == 6 else {
          throw MooZError.invalid(
            "Expected six jobs in native preview, got \(model.preview.count); inputs \(model.productIDs.count), copies \(model.draft.copies): \(model.error ?? "no planner error")"
          )
        }
        // Verify six planned combinations, execute one two-scene job for the launch check.
        model.preview = [model.preview[0]]
        await model.enqueue()
        await model.toggleQueue()
        let deadline = Date().addingTimeInterval(90)
        var completed: Job?
        while Date() < deadline {
          await model.reloadFilesAndJobs()
          if let job = model.jobs.first, job.state == .completed {
            completed = job
            break
          }
          try await Task.sleep(nanoseconds: 250_000_000)
        }
        guard let job = completed, let finalID = job.finalAssetID,
          let final = model.assets.first(where: { $0.id == finalID })
        else { throw MooZError.invalid("Native queue did not persist a final MP4") }
        let (sent, acks) = await fixture.evidence()
        guard sent.count == 2, acks == 2, sent[1].timeIntervalSince(sent[0]) >= 10 else {
          throw MooZError.invalid("Duplicate dispatch, missing ACK, or cooldown violation")
        }
        let reopened = try WorkspaceStore(root: model.root)
        guard try await reopened.job(job.id)?.state == .completed else {
          throw MooZError.storage("Restart lost job")
        }
        _ = try await reopened.data(for: final)
        let duration = try await media.inspect(model.fileURL(final)).duration
        guard abs(duration - 2) < 0.15 else {
          throw MooZError.invalid("Wrong scene assembly duration")
        }
        model.finishVideoID = final.id
        model.finishing.start = 0.2
        model.finishing.end = 1.5
        model.finishing.captions = "1\n00:00:00,000 --> 00:00:01,000\nMooZ native smoke\n"
        let finished = try await model.makeFinishedMovie()
        let bytes = try await reopened.data(for: finished)
        try bytes.write(
          to: output.appendingPathComponent("native-smoke-final.mp4"), options: .atomic)
        model.page = .canvas
        guard let view = NSApplication.shared.windows.first(where: { $0.isVisible })?.contentView
        else { throw MooZError.unavailable("Native window is not visible") }
        view.layoutSubtreeIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
          throw MooZError.unavailable("Cannot capture native window")
        }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let screenshot = bitmap.representation(using: .png, properties: [:]) else {
          throw MooZError.unavailable("Native screenshot is empty")
        }
        try screenshot.write(to: output.appendingPathComponent("native-smoke.png"))
        let evidence: [String: Any] = [
          "provider": "fixture, no live AI", "plannedJobs": 6, "executedJobs": 1,
          "sceneSubmissions": sent.count, "acknowledgements": acks,
          "cooldownSeconds": sent[1].timeIntervalSince(sent[0]),
          "reopenedDatabase": true, "assembledDuration": duration, "finalBytes": bytes.count,
        ]
        try JSONSerialization.data(
          withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]
        ).write(to: output.appendingPathComponent("native-smoke.json"))
        print(
          "PASS native launch, file import, preview, queue, restart, scene assembly and postproduction (fixture provider)"
        )
        NSApplication.shared.terminate(nil)
      } catch {
        fputs("Native smoke failed: \(error.localizedDescription)\n", stderr)
        exit(1)
      }
    }
  }
#endif
