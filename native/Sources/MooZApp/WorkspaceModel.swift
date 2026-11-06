#if os(macOS)
  import AppKit
  import SwiftUI
  import UniformTypeIdentifiers
  import MooZCore

  @MainActor final class WorkspaceModel: ObservableObject {
    enum Page: String, CaseIterable, Identifiable {
      case canvas = "Canvas"
      case batch = "Tạo hàng loạt"
      case library = "Kho"
      case finishing = "Hậu kỳ"
      case settings = "Kết nối"
      var id: String { rawValue }
    }
    enum GroupMode: String, CaseIterable {
      case separate = "Tách từng ảnh"
      case combined = "Gộp một sản phẩm"
      case manual = "Nhóm thủ công"
    }
    @Published var page: Page = .canvas
    @Published var projects: [Project] = []
    @Published var project: Project?
    @Published var assets: [Asset] = []
    @Published var jobs: [Job] = []
    @Published var preview: [Job] = []
    @Published var previewIndex = 0
    @Published var draft = BatchDraft()
    @Published var promptText = ""
    @Published var sceneText = ""
    @Published var productIDs: [String] = []
    @Published var groupMode: GroupMode = .separate
    @Published var manualGroups: [ProductGroup] = []
    @Published var error: String?
    @Published var notice = ""
    @Published var tabs: [ChromeTab] = []
    @Published var pairing = ""
    @Published var running = false
    @Published var importing = false
    @Published var rendering = false
    @Published var ready = false
    @Published var finishing = FinishingSettings()
    @Published var finishVideoID = "", musicID = "", voiceID = ""
    let store: WorkspaceStore
    let chrome: ChromeSocketServer
    let chromeProvider: ChromeProvider
    let queue: GenerationQueue
    let media: NativeMediaTools?
    let root: URL
    private var execution: Task<Void, Never>?
    private var refresh: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    init(root: URL? = nil) throws {
      self.root =
        root
        ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("MooZNative", isDirectory: true)
      store = try WorkspaceStore(root: self.root)
      chrome = ChromeSocketServer(directory: self.root.appendingPathComponent("chrome"))
      chromeProvider = ChromeProvider(transport: chrome, store: store)
      media = try? NativeMediaTools()
      var providers: [String: any GenerationProvider] = [:]
      for service in [APIProvider.Service.openai, .google, .fal] {
        providers[service.rawValue] = APIProvider(
          service: service, key: { try KeychainVault.read(service.rawValue) })
      }
      for id in ["muse", "chatgpt", "gemini", "grok", "flow"] { providers[id] = chromeProvider }
      queue = GenerationQueue(store: store, providers: providers, assembler: media)
      Task { await start() }
    }
    private func start() async {
      do {
        try await store.recoverInterrupted()
        projects = try await store.projects()
        if projects.isEmpty {
          let created = try await store.saveProject(Project(name: "Dự án đầu tiên"))
          projects = [created]
        }
        if let first = projects.first { await selectProject(first.id) }
        do {
          try await chrome.start()
          pairing = await chrome.pairingURI()
        } catch { notice = "Chưa mở được kết nối Chrome: \(error.localizedDescription)" }
        ready = true
        execution = Task { [weak self] in
          while !Task.isCancelled {
            guard let self else { return }
            do { try await self.queue.tick() } catch { self.error = error.localizedDescription }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
          }
        }
        refresh = Task { [weak self] in
          while !Task.isCancelled {
            guard let self else { return }
            await self.reloadFilesAndJobs()
            self.pairing = await self.chrome.pairingURI()
            try? await Task.sleep(nanoseconds: 1_000_000_000)
          }
        }
      } catch { self.error = error.localizedDescription }
    }
    func reloadFilesAndJobs() async {
      do {
        assets = try await store.assets()
        jobs = try await store.jobs(projectID: project?.id)
      } catch { self.error = error.localizedDescription }
    }
    func selectProject(_ id: String) async {
      do {
        if let current = project { try await persistDraft(currentID: current.id) }
        projects = try await store.projects()
        guard let selected = projects.first(where: { $0.id == id }) else { return }
        project = selected
        draft = selected.draft
        preview = selected.previewJobs ?? []
        previewIndex = 0
        promptText = draft.prompts.joined(separator: "\n\n")
        sceneText = draft.scenePrompts.joined(separator: "\n---\n")
        manualGroups = draft.groups
        productIDs = Array(NSOrderedSet(array: draft.groups.flatMap(\.assetIDs))) as? [String] ?? []
        groupMode =
          draft.productMode == "manual"
          ? .manual : draft.productMode == "combined" ? .combined : .separate
        if groupMode == .manual { productIDs = draft.pendingProductIDs ?? [] }
        finishing = selected.finishing ?? FinishingSettings()
        finishVideoID = finishing.videoAssetID ?? ""
        musicID = finishing.musicAssetID ?? ""
        voiceID = finishing.voiceAssetID ?? ""
        await reloadFilesAndJobs()
      } catch { self.error = error.localizedDescription }
    }
    func createProject(_ name: String) async {
      do {
        if let current = project { try await persistDraft(currentID: current.id) }
        let created = try await store.saveProject(Project(name: name))
        projects = try await store.projects()
        project = nil
        await selectProject(created.id)
      } catch { self.error = error.localizedDescription }
    }
    func makeDraft() -> BatchDraft {
      var value = draft
      value.productMode =
        groupMode == .manual ? "manual" : groupMode == .combined ? "combined" : "separate"
      value.prompts = promptText.components(separatedBy: "\n\n").map {
        $0.trimmingCharacters(in: .whitespacesAndNewlines)
      }.filter { !$0.isEmpty }
      value.scenePrompts =
        sceneText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? []
        : sceneText.components(separatedBy: "\n---\n").map {
          $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }
      switch groupMode {
      case .separate:
        value.groups = productIDs.map { id in
          ProductGroup(
            id: id, name: assets.first(where: { $0.id == id })?.name ?? "Sản phẩm", assetIDs: [id])
        }
      case .combined:
        value.groups =
          productIDs.isEmpty
          ? [] : [ProductGroup(id: "combined", name: "Sản phẩm nhiều góc", assetIDs: productIDs)]
      case .manual: value.groups = manualGroups
      }
      value.pendingProductIDs = groupMode == .manual ? productIDs : nil
      let count = value.groups.map { $0.assetIDs.count }.min() ?? 0
      value.productSlots = value.productSlots.filter { $0.imageIndex >= 0 && $0.imageIndex < count }
      return value
    }
    func changed() {
      if let project, makeDraft() == project.draft { return }
      preview = []
      previewIndex = 0
      scheduleSave()
    }
    func finishingChanged() {
      finishing.videoAssetID = finishVideoID
      finishing.musicAssetID = musicID
      finishing.voiceAssetID = voiceID
      scheduleSave()
    }
    private func scheduleSave() {
      saveTask?.cancel()
      saveTask = Task {
        do {
          try await Task.sleep(nanoseconds: 300_000_000)
          try Task.checkCancellation()
          if let id = project?.id { try await persistDraft(currentID: id) }
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
      }
    }
    private func persistDraft(currentID: String) async throws {
      guard project?.id == currentID else { return }
      let saved = try await store.saveDraft(
        projectID: currentID, draft: makeDraft(), preview: preview, finishing: finishing)
      if project?.id == currentID { project = saved }
      projects = try await store.projects()
    }
    func plan() async {
      do {
        guard let project else { return }
        if groupMode == .manual, !productIDs.isEmpty {
          throw MooZError.invalid("Còn ảnh chưa đưa vào nhóm thủ công.")
        }
        let value = makeDraft()
        preview = try BatchPlanner.plan(
          projectID: project.id, draft: value, assets: assets, existingJobs: jobs.count)
        draft = value
        previewIndex = 0
        error = nil
        notice = "\(preview.count) tác vụ. Chưa gửi AI."
        try await persistDraft(currentID: project.id)
      } catch {
        preview = []
        self.error = error.localizedDescription
      }
    }
    func enqueue() async {
      do {
        guard !preview.isEmpty else { throw MooZError.invalid("Xem kế hoạch trước khi xếp hàng.") }
        let frozen = try preview.map { try CanvasCompiler.compile($0, graph: $0.graph) }
        try await store.enqueue(frozen)
        notice = "Đã chốt \(frozen.count) tác vụ. Bấm Chạy hàng đợi để gửi."
        preview = []
        await reloadFilesAndJobs()
        if let id = project?.id { try await persistDraft(currentID: id) }
      } catch { self.error = error.localizedDescription }
    }
    func toggleQueue() async {
      running.toggle()
      await queue.setEnabled(running)
    }
    func importFiles(audio: Bool = false) async {
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = true
      panel.canChooseDirectories = false
      let types: [UTType?] = [.png, .jpeg, .mpeg4Movie, UTType(filenameExtension: "webp")]
      panel.allowedContentTypes = audio ? [.audio] : types.compactMap { $0 }
      guard panel.runModal() == .OK else { return }
      await importURLs(panel.urls)
    }
    func importURLs(_ urls: [URL]) async {
      importing = true
      defer { importing = false }
      for url in urls {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
          let bytes = try await Task.detached { try Data(contentsOf: url) }.value
          let mime: String
          switch url.pathExtension.lowercased() {
          case "png": mime = "image/png"
          case "jpg", "jpeg": mime = "image/jpeg"
          case "webp": mime = "image/webp"
          case "mp4": mime = "video/mp4"
          case "wav": mime = "audio/wav"
          case "mp3": mime = "audio/mpeg"
          default: throw MooZError.invalid("Chọn PNG/JPG/WebP/MP4 hoặc WAV/MP3.")
          }
          if mime.hasPrefix("video/") || mime.hasPrefix("audio/") {
            guard let media else {
              throw MooZError.unavailable("Cần FFmpeg để kiểm tra video/âm thanh nhập vào.")
            }
            try await media.validate(bytes, mime: mime)
          }
          let asset = try await store.importAsset(
            data: bytes, name: url.lastPathComponent, mime: mime)
          if asset.kind == .image, !productIDs.contains(asset.id) { productIDs.append(asset.id) }
          if asset.kind == .video { finishVideoID = asset.id }
        } catch { self.error = error.localizedDescription }
      }
      if !productIDs.isEmpty { _ = productAlias() }
      await reloadFilesAndJobs()
      changed()
    }
    private func nextAlias() -> String {
      let maxExisting =
        (draft.shared.map(\.alias) + draft.productSlots.map(\.alias)).compactMap {
          Int($0.replacingOccurrences(of: "anh", with: ""))
        }.max() ?? 0
      let next = max(draft.slotSequence ?? 0, maxExisting) + 1
      draft.slotSequence = next
      return "anh\(next)"
    }
    func productAlias(at index: Int = 0) -> String {
      if let first = draft.productSlots.first(where: { $0.imageIndex == index }) {
        return first.alias
      }
      let alias = nextAlias()
      draft.productSlots.append(ProductSlot(alias, imageIndex: index))
      return alias
    }
    func referenceToken(_ id: String) -> String {
      if let ref = draft.shared.first(where: { $0.assetID == id }) { return "@" + ref.alias }
      if let index = productIDs.firstIndex(of: id) {
        return "@" + productAlias(at: groupMode == .combined ? index : 0)
      }
      if let group = manualGroups.first(where: { $0.assetIDs.contains(id) }),
        let index = group.assetIDs.firstIndex(of: id)
      {
        return "@" + productAlias(at: index)
      }
      let alias = nextAlias()
      draft.shared.append(Reference(id, role: .reference, alias: alias))
      changed()
      return "@" + alias
    }
    func setRole(_ id: String, role: String) {
      if let index = draft.shared.firstIndex(where: { $0.assetID == id }) {
        if let role = ReferenceRole(rawValue: role) {
          draft.shared[index].role = role
        } else {
          draft.shared.remove(at: index)
        }
      } else if let role = ReferenceRole(rawValue: role) {
        let alias = nextAlias()
        draft.shared.append(Reference(id, role: role, alias: alias))
      }
      productIDs.removeAll { $0 == id }
      changed()
    }
    func addManualGroup() {
      guard !productIDs.isEmpty else { return }
      manualGroups.append(
        ProductGroup(name: "Sản phẩm \(manualGroups.count+1)", assetIDs: productIDs))
      productIDs = []
      changed()
    }
    func setProvider(_ id: String) {
      draft.binding = TabBinding(provider: id)
      draft.settings.model =
        id == "openai"
        ? (draft.settings.kind == .text ? "gpt-4.1-mini" : "gpt-image-1")
        : id == "google"
          ? (draft.settings.kind == .video
            ? "veo-3.1-generate-preview"
            : draft.settings.kind == .text ? "gemini-2.5-flash" : "gemini-2.5-flash-image")
          : id == "fal" ? "fal-ai/veo3.1" : id
      draft.settings.maxReferences =
        (id == "fal" || id == "google" && draft.settings.kind == .video) ? 1 : 8
      if draft.settings.kind == .video {
        draft.settings.ratio = "16:9"
        draft.settings.resolution = "720P"
      }
      changed()
    }
    func setOutputKind(_ kind: MediaKind) {
      guard draft.settings.kind != kind else { return }
      let binding = draft.binding
      draft.settings.kind = kind
      setProvider(binding.provider)
      if binding.tabID != nil { draft.binding = binding }
      changed()
    }
    func refreshTabs() async {
      do {
        tabs = try await chromeProvider.tabs()
        error = nil
        notice = "Đã đọc \(tabs.count) tab AI."
      } catch { self.error = error.localizedDescription }
    }
    func selectTab(_ id: Int) async {
      guard let tab = tabs.first(where: { $0.id == id }),
        let provider = ConversationIdentity.provider(tab.url)
      else { return }
      let identity = await chrome.identity()
      draft.binding = TabBinding(
        provider: provider, deviceID: identity.deviceID, tabID: id, epoch: identity.epoch,
        conversationURL: tab.url)
      changed()
    }
    func saveKey(_ value: String, provider: String) {
      do {
        try KeychainVault.save(value, account: provider)
        notice = "Đã lưu khóa vào Keychain."
        error = nil
      } catch { self.error = error.localizedDescription }
    }
    func fileURL(_ asset: Asset) -> URL { root.appendingPathComponent(asset.relativePath) }
    func reveal(_ asset: Asset) { NSWorkspace.shared.activateFileViewerSelecting([fileURL(asset)]) }
    func export(_ asset: Asset) async {
      let panel = NSSavePanel()
      panel.nameFieldStringValue = asset.name
      guard panel.runModal() == .OK, let url = panel.url else { return }
      do {
        let data = try await store.data(for: asset)
        try data.write(to: url, options: .atomic)
        notice = "Đã xuất \(url.lastPathComponent)."
      } catch { self.error = error.localizedDescription }
    }
    func makeFinishedMovie() async throws -> Asset {
      guard let media else {
        throw MooZError.unavailable("Cần FFmpeg/ffprobe native trước khi xuất.")
      }
      let recipe = finishing
      let available = assets
      let selectedVideo = finishVideoID
      let selectedMusic = musicID
      let selectedVoice = voiceID
      let outputName = "\(project?.name ?? "MooZ")-final.mp4"
      rendering = true
      defer { rendering = false }
      let ids = recipe.clipIDs.flatMap { $0.isEmpty ? nil : $0 } ?? [selectedVideo]
      guard !ids.isEmpty, ids.count <= 12 else {
        throw MooZError.invalid("Chọn từ 1 đến 12 clip để dựng.")
      }
      var sources: [URL] = []
      for id in ids {
        guard let video = available.first(where: { $0.id == id && $0.kind == .video }) else {
          throw MooZError.invalid("Clip hậu kỳ bị thiếu.")
        }
        _ = try await store.data(for: video)
        sources.append(try await store.fileURL(for: video))
      }
      let assembled: URL?
      if sources.count > 1 {
        assembled = try await media.assemble(sources)
      } else {
        assembled = nil
      }
      defer { if let assembled { Task { await media.discard(assembled) } } }
      let source = assembled ?? sources[0]
      let music = try await available.first(where: { $0.id == selectedMusic }).asyncURL(store)
      let voice = try await available.first(where: { $0.id == selectedVoice }).asyncURL(store)
      let file = try await media.finish(source, music: music, voice: voice, settings: recipe)
      defer { Task { await media.discard(file) } }
      let asset = try await store.importAsset(
        data: Data(contentsOf: file), name: outputName, mime: "video/mp4", origin: .result,
        requestID: UUID().uuidString, itemID: "post-final")
      await reloadFilesAndJobs()
      notice = "MP4 đã được giải mã kiểm tra và lưu trong Kho."
      return asset
    }
    func exportMovie() async {
      do {
        let asset = try await makeFinishedMovie()
        await export(asset)
      } catch { self.error = error.localizedDescription }
    }
    func updateGraph(_ graph: WorkflowGraph) {
      guard preview.indices.contains(previewIndex) else { return }
      do {
        try graph.validate()
        preview[previewIndex].graph = graph
        preview[previewIndex] = try CanvasCompiler.compile(preview[previewIndex], graph: graph)
        Task {
          if let id = project?.id {
            do { try await persistDraft(currentID: id) } catch {
              self.error = error.localizedDescription
            }
          }
        }
      } catch { self.error = error.localizedDescription }
    }
  }
  extension Optional where Wrapped == Asset {
    fileprivate func asyncURL(_ store: WorkspaceStore) async throws -> URL? {
      guard let asset = self else { return nil }
      _ = try await store.data(for: asset)
      return try await store.fileURL(for: asset)
    }
  }
#endif
