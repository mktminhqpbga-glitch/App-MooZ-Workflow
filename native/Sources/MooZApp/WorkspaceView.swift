#if os(macOS)
  import SwiftUI
  import AppKit
  import AVKit
  import MooZCore

  struct WorkspaceView: View {
    @ObservedObject var model: WorkspaceModel
    @State private var newProject = false
    @State private var projectName = ""
    var body: some View {
      NavigationSplitView {
        VStack(alignment: .leading, spacing: 22) {
          Text("MooZ").font(.system(size: 25, weight: .bold, design: .rounded)).padding(.top, 12)
          Text("KHÔNG GIAN SÁNG TẠO").font(.caption2).foregroundStyle(.secondary)
          ForEach(WorkspaceModel.Page.allCases) { page in
            Button {
              model.page = page
            } label: {
              Label(page.rawValue, systemImage: symbol(page)).frame(
                maxWidth: .infinity, alignment: .leading
              ).padding(10).background(
                model.page == page ? Color.accentColor.opacity(0.2) : .clear,
                in: RoundedRectangle(cornerRadius: 9))
            }.buttonStyle(.plain)
          }
          Spacer()
          Text("Dữ liệu trên máy của bạn").font(.caption).foregroundStyle(.secondary)
          Button("Mở thư mục dữ liệu") { NSWorkspace.shared.open(model.root) }.font(.caption)
        }.padding(18).frame(minWidth: 175)
      } detail: {
        VStack(spacing: 0) {
          HStack {
            Picker(
              "Dự án",
              selection: Binding(
                get: { model.project?.id ?? "" },
                set: { id in Task { await model.selectProject(id) } })
            ) {
              ForEach(model.projects) { Text($0.name).tag($0.id) }
            }.frame(width: 270)
            Button {
              newProject = true
            } label: {
              Image(systemName: "plus")
            }.help("Tạo dự án")
            Spacer()
            Button {
              Task { await model.importFiles() }
            } label: {
              Label("Thêm file", systemImage: "plus.rectangle.on.folder")
            }.disabled(model.importing)
            Button {
              Task { await model.toggleQueue() }
            } label: {
              Label(
                model.running ? "Tạm dừng cấp việc" : "Chạy hàng đợi",
                systemImage: model.running ? "pause.fill" : "play.fill")
            }.buttonStyle(.borderedProminent)
          }.padding(16)
          Divider()
          if let error = model.error {
            HStack(alignment: .top) {
              Image(systemName: "exclamationmark.triangle.fill")
              Text(error).textSelection(.enabled)
              Spacer()
              Button {
                model.error = nil
              } label: {
                Image(systemName: "xmark")
              }
            }.font(.callout).foregroundStyle(.red).padding(12).background(Color.red.opacity(0.08))
          }
          switch model.page {
          case .canvas: CanvasWorkspace(model: model)
          case .batch:
            HSplitView {
              Composer(model: model).frame(minWidth: 530)
              QueuePane(model: model).frame(minWidth: 310, maxWidth: 440)
            }
          case .library: LibraryWorkspace(model: model)
          case .finishing: FinishingWorkspace(model: model)
          case .settings: ConnectionWorkspace(model: model)
          }
          Divider()
          HStack {
            Text(model.notice).lineLimit(2)
            Spacer()
            Text(
              "\(model.jobs.filter{$0.state == .completed}.count)/\(model.jobs.count) tác vụ hoàn tất"
            )
          }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 16).padding(
            .vertical, 9)
        }
      }
      .navigationSplitViewStyle(.balanced)
      .sheet(isPresented: $newProject) {
        VStack(alignment: .leading, spacing: 18) {
          Text("Dự án mới").font(.title2)
          TextField("Tên dự án", text: $projectName)
          HStack {
            Spacer()
            Button("Hủy") { newProject = false }
            Button("Tạo") {
              let name = projectName
              newProject = false
              Task { await model.createProject(name) }
            }.disabled(projectName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }.padding(24).frame(width: 400)
      }
    }
    private func symbol(_ page: WorkspaceModel.Page) -> String {
      switch page {
      case .canvas: return "point.3.connected.trianglepath.dotted"
      case .batch: return "square.stack.3d.up"
      case .library: return "photo.on.rectangle.angled"
      case .finishing: return "film.stack"
      case .settings: return "slider.horizontal.3"
      }
    }
  }

  struct Composer: View {
    @ObservedObject var model: WorkspaceModel
    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          HStack {
            Text("Từ đầu vào đến thành phẩm").font(.title2.bold())
            Spacer()
            Button("Thêm ảnh / video") { Task { await model.importFiles() } }
          }
          Text("Ảnh sản phẩm").font(.headline)
          Picker("Cách tạo tác vụ", selection: $model.groupMode) {
            ForEach(WorkspaceModel.GroupMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
          }.pickerStyle(.segmented).onChange(of: model.groupMode) { _ in model.changed() }
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 110, maximum: 150))], spacing: 12) {
            ForEach(model.assets.filter { $0.kind == .image && $0.origin == .input }) { asset in
              VStack(spacing: 5) {
                AssetThumbnail(asset: asset, url: model.fileURL(asset)).frame(height: 85).overlay(
                  alignment: .topTrailing
                ) {
                  if model.productIDs.contains(asset.id) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentColor)
                      .padding(5)
                  }
                }
                Text(asset.name).font(.caption).lineLimit(1)
              }.padding(6).background(
                model.productIDs.contains(asset.id)
                  ? Color.accentColor.opacity(0.14) : Color.white.opacity(0.04),
                in: RoundedRectangle(cornerRadius: 9)
              )
              .onTapGesture {
                if let i = model.productIDs.firstIndex(of: asset.id) {
                  model.productIDs.remove(at: i)
                } else {
                  model.productIDs.append(asset.id)
                  _ = model.productAlias()
                }
                model.changed()
              }
              .onDrag { NSItemProvider(object: ("mooz-asset:" + asset.id) as NSString) }
            }
          }
          if model.groupMode == .manual {
            Button("Tạo nhóm từ \(model.productIDs.count) ảnh đang chọn") { model.addManualGroup() }
              .disabled(model.productIDs.isEmpty)
            ForEach(model.manualGroups) { group in
              HStack {
                Text("\(group.name) · \(group.assetIDs.count) ảnh")
                Spacer()
                Button("Bỏ nhóm") {
                  model.manualGroups.removeAll { $0.id == group.id }
                  model.changed()
                }
              }.font(.caption)
            }
          }
          DisclosureGroup("Nhân vật, bối cảnh và phong cách (tùy chọn)") {
            ForEach(model.assets.filter { $0.kind == .image }) { asset in
              HStack {
                AssetThumbnail(asset: asset, url: model.fileURL(asset)).frame(width: 42, height: 38)
                Text(asset.name).lineLimit(1)
                Spacer()
                Picker(
                  "Vai trò",
                  selection: Binding(
                    get: {
                      model.draft.shared.first(where: { $0.assetID == asset.id })?.role.rawValue
                        ?? "none"
                    }, set: { model.setRole(asset.id, role: $0) })
                ) {
                  Text("Không dùng chung").tag("none")
                  Text("Nhân vật").tag("character")
                  Text("Bối cảnh").tag("background")
                  Text("Phong cách").tag("style")
                  Text("Tham chiếu").tag("reference")
                }.labelsHidden().frame(width: 165)
              }.onDrag { NSItemProvider(object: ("mooz-asset:" + asset.id) as NSString) }
            }
          }
          Text("Yêu cầu").font(.headline)
          Text(
            "Mỗi đoạn cách nhau một dòng trống là một yêu cầu. Kéo ảnh vào vị trí muốn chèn thẻ."
          ).font(.caption).foregroundStyle(.secondary)
          PromptEditor(text: $model.promptText, token: model.referenceToken).frame(height: 170)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10)).overlay(
              RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.12))
            ).onChange(of: model.promptText) { _ in model.changed() }
          HStack {
            ForEach(model.draft.shared, id: \.alias) { ref in
              Text("@\(ref.alias) · \(ref.role.rawValue)").font(.caption).padding(6).background(
                Color.accentColor.opacity(0.15), in: Capsule())
            }
            if let slot = model.draft.productSlots.first {
              Text("@\(slot.alias) · sản phẩm theo từng job").font(.caption).foregroundStyle(
                .secondary)
            }
          }
          DisclosureGroup("Video nhiều cảnh") {
            Text("Nhập yêu cầu từng cảnh, ngăn bằng dòng --- . Các clip được ghép theo thứ tự này.")
              .font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $model.sceneText).font(.body).frame(height: 130).onChange(
              of: model.sceneText
            ) { _ in model.changed() }
          }
          GenerationControls(model: model)
          Stepper(
            "\(model.draft.copies) bản tạo cho mỗi tổ hợp", value: $model.draft.copies, in: 1...10
          ).onChange(of: model.draft.copies) { _ in model.changed() }
          HStack {
            Button("Xem kế hoạch") { Task { await model.plan() } }
            Spacer()
            Button("Xếp \(model.preview.count) tác vụ") { Task { await model.enqueue() } }
              .buttonStyle(.borderedProminent).disabled(model.preview.isEmpty)
          }
          if !model.preview.isEmpty {
            Text("Xác nhận ảnh của từng tác vụ").font(.headline)
            Text(
              "\(model.preview.count) tác vụ · \(model.preview.reduce(0){$0+$1.scenes.count}) lượt gửi AI"
            ).font(.caption).foregroundStyle(.secondary)
            ForEach(model.preview) { job in JobPlanCard(job: job, fileURL: model.fileURL) }
          }
        }.padding(22)
      }
    }
  }

  struct JobPlanCard: View {
    let job: Job
    let fileURL: (Asset) -> URL
    var body: some View {
      VStack(alignment: .leading, spacing: 9) {
        Text(job.title).font(.subheadline.bold())
        Text(job.originalPrompt).font(.caption).lineLimit(3)
        Text(
          "\(job.settings.model) · \(job.settings.ratio) · \(job.settings.quality) · bản \(job.copy)"
        ).font(.caption2).foregroundStyle(.secondary)
        Text(
          job.binding.tabID.map { "Chrome · tab \($0) · \(job.binding.conversationURL ?? "")" }
            ?? "API · \(job.binding.provider)"
        ).font(.caption2).textSelection(.enabled)
        ForEach(job.scenes) { scene in
          VStack(alignment: .leading, spacing: 6) {
            Text("Cảnh \(scene.index) · \(scene.inputAssetIDs?.count ?? job.inputAssets.count) ảnh")
              .font(.caption.bold())
            ScrollView(.horizontal) {
              HStack {
                ForEach(
                  job.references.filter { scene.inputAssetIDs?.contains($0.assetID) != false },
                  id: \.alias
                ) { ref in
                  if let asset = job.inputAssets.first(where: { $0.id == ref.assetID }) {
                    VStack {
                      AssetThumbnail(asset: asset, url: fileURL(asset)).frame(width: 64, height: 50)
                      Text("@\(ref.alias) · \(ref.role.rawValue)").font(.caption2)
                    }
                  }
                }
              }
            }
            DisclosureGroup("Prompt và mã sẽ gửi") {
              Text(scene.wirePrompt(kind: job.settings.kind)).font(
                .system(.caption, design: .monospaced)
              ).textSelection(.enabled)
            }.font(.caption)
          }
        }
      }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(
        Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }
  }

  struct GenerationControls: View {
    @ObservedObject var model: WorkspaceModel
    var body: some View {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Picker(
            "Đầu ra",
            selection: Binding(get: { model.draft.settings.kind }, set: model.setOutputKind)
          ) {
            Text("Ảnh").tag(MediaKind.image)
            Text("Video").tag(MediaKind.video)
            Text("Văn bản").tag(MediaKind.text)
          }
          Picker(
            "AI", selection: Binding(get: { model.draft.binding.provider }, set: model.setProvider)
          ) {
            Text("OpenAI API").tag("openai")
            Text("Google API").tag("google")
            Text("fal · Veo API").tag("fal")
            ForEach(["muse", "chatgpt", "gemini", "grok", "flow"], id: \.self) {
              Text("Chrome · " + $0).tag($0)
            }
          }
        }
        TextField("Model", text: $model.draft.settings.model).onChange(
          of: model.draft.settings.model
        ) { _ in model.changed() }
        HStack {
          Picker("Khung", selection: $model.draft.settings.ratio) {
            ForEach(["1:1", "2:3", "3:2", "16:9", "9:16"], id: \.self) { Text($0).tag($0) }
          }
          Picker("Chất lượng", selection: $model.draft.settings.quality) {
            Text("Thấp").tag("low")
            Text("Vừa").tag("medium")
            Text("Cao").tag("high")
          }
        }.onChange(of: model.draft.settings) { _ in model.changed() }
        if model.draft.settings.kind == .video {
          HStack {
            Picker("Thời lượng", selection: $model.draft.settings.duration) {
              ForEach([4, 6, 8], id: \.self) { Text("\($0) giây").tag($0) }
            }
            Picker("Độ phân giải", selection: $model.draft.settings.resolution) {
              Text("720P").tag("720P")
              Text("1080P").tag("1080P")
            }
          }
        }
        if !["openai", "google", "fal"].contains(model.draft.binding.provider) {
          Text(
            "Chọn model và chất lượng trong tab AI trước khi chạy. App chưa xác minh được các thiết lập đó trên website."
          ).font(.caption).foregroundStyle(.orange)
          HStack {
            Picker(
              "Tab cố định",
              selection: Binding(
                get: { model.draft.binding.tabID ?? -1 },
                set: { id in Task { await model.selectTab(id) } })
            ) {
              Text("Chọn tab đã kết nối").tag(-1)
              ForEach(
                model.tabs.filter {
                  ConversationIdentity.provider($0.url) == model.draft.binding.provider
                }
              ) { Text($0.title).tag($0.id) }
            }
            Button {
              Task { await model.refreshTabs() }
            } label: {
              Image(systemName: "arrow.clockwise")
            }
          }
          Text("Tab bận sẽ chờ; không tự chuyển sang tab khác.").font(.caption).foregroundStyle(
            .secondary)
        }
      }.padding(12).background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
    }
  }

  struct QueuePane: View {
    @ObservedObject var model: WorkspaceModel
    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          Text("Hàng đợi chung").font(.title3.bold())
          Text("Canvas và tạo hàng loạt dùng cùng tác vụ, file và trạng thái.").font(.caption)
            .foregroundStyle(.secondary)
          ForEach(model.jobs) { job in
            VStack(alignment: .leading, spacing: 8) {
              HStack {
                if [.waitingTab, .dispatching, .sent, .collecting, .assembling].contains(job.state)
                {
                  ProgressView().controlSize(.small)
                } else {
                  Image(systemName: job.state == .completed ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(job.state == .completed ? .green : .secondary)
                }
                Text(job.title).font(.headline)
                Spacer()
                Text(job.state.label).font(.caption).foregroundStyle(
                  [.failed, .unknown].contains(job.state) ? .red : .secondary)
              }
              Text(
                "\(job.settings.model) · \(job.scenes.filter{$0.state == .completed}.count)/\(job.scenes.count) cảnh"
              ).font(.caption).foregroundStyle(.secondary)
              if let error = job.error {
                Text(error).font(.caption).foregroundStyle(
                  [.unknown, .failed].contains(job.state) ? .red : .secondary
                ).textSelection(.enabled)
              }
              ForEach(job.scenes) { scene in
                Text("Cảnh \(scene.index) · \(scene.requestCode ?? scene.requestID)").font(
                  .system(size: 10, design: .monospaced)
                ).foregroundStyle(.secondary).textSelection(.enabled)
              }
              let ids = job.scenes.flatMap(\.outputIDs)
              HStack {
                ForEach(Array(ids.prefix(4)), id: \.self) { id in
                  if let asset = model.assets.first(where: { $0.id == id }) {
                    AssetThumbnail(asset: asset, url: model.fileURL(asset)).frame(
                      width: 64, height: 54
                    ).onTapGesture { NSWorkspace.shared.open(model.fileURL(asset)) }
                  }
                }
              }
              if let final = job.finalAssetID,
                let asset = model.assets.first(where: { $0.id == final })
              {
                Button("Tải thành phẩm") { Task { await model.export(asset) } }
              }
            }.padding(12).background(
              Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
          }
        }.padding(18)
      }
    }
  }
  extension JobState {
    fileprivate var label: String {
      switch self {
      case .queued: return "Chờ chạy"
      case .waitingTab: return "Chờ tab"
      case .dispatching: return "Chuẩn bị gửi"
      case .sent: return "Đã gửi"
      case .collecting: return "Đang nhận"
      case .partial: return "Đã lưu một phần"
      case .unknown: return "Cần đối chiếu"
      case .assembling: return "Đang ghép"
      case .readyToAssemble: return "Chờ ghép"
      case .completed: return "Hoàn tất"
      case .failed: return "Lỗi"
      case .stopped: return "Đã dừng"
      }
    }
  }

  struct CanvasWorkspace: View {
    @ObservedObject var model: WorkspaceModel
    @State private var selectedJob = ""
    var body: some View {
      let editable = model.preview.indices.contains(model.previewIndex)
      let job =
        editable
        ? model.preview[model.previewIndex]
        : model.jobs.first(where: { $0.id == selectedJob }) ?? model.jobs.last
      HSplitView {
        VStack(spacing: 0) {
          HStack {
            Text("Canvas").font(.headline)
            Spacer()
            if editable {
              Picker("Kế hoạch", selection: $model.previewIndex) {
                ForEach(model.preview.indices, id: \.self) { Text(model.preview[$0].title).tag($0) }
              }.frame(width: 240)
            } else {
              Picker("Tác vụ", selection: $selectedJob) {
                Text("Mới nhất").tag("")
                ForEach(model.jobs) { Text($0.title).tag($0.id) }
              }.frame(width: 240)
            }
          }.padding(14)
          if let job {
            NativeCanvas(
              graph: displayGraph(job),
              files: Dictionary(
                uniqueKeysWithValues: model.assets.map { ($0.id, model.fileURL($0)) }),
              editable: editable, update: model.updateGraph, error: { model.error = $0 })
            Text(
              editable
                ? "Kéo node để sắp xếp · kéo cổng phải sang node đích để nối · Delete bỏ dây vào node đang chọn"
                : "Snapshot của tác vụ đã chốt; đầu vào và tab không thay đổi theo bản nháp."
            ).font(.caption).foregroundStyle(.secondary).padding(10)
          } else {
            VStack(spacing: 14) {
              Image(systemName: "point.3.connected.trianglepath.dotted").font(.system(size: 44))
              Text("Chọn ảnh, nhập yêu cầu và xem kế hoạch để bắt đầu.").foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }.frame(minWidth: 540)
        Composer(model: model).frame(minWidth: 360, maxWidth: 500)
      }
    }
    private func displayGraph(_ job: Job) -> WorkflowGraph {
      var graph = job.graph
      for scene in job.scenes {
        if let index = graph.nodes.firstIndex(where: { $0.id == scene.requestID }) {
          graph.nodes[index].assetID = scene.outputIDs.first
        }
      }
      if let index = graph.nodes.firstIndex(where: { $0.id == "final-" + job.id }) {
        graph.nodes[index].assetID = job.finalAssetID
      }
      return graph
    }
  }

  struct AssetThumbnail: View {
    let asset: Asset
    let url: URL
    @State private var image: NSImage?
    var body: some View {
      ZStack {
        RoundedRectangle(cornerRadius: 7).fill(Color.black.opacity(0.25))
        if let image {
          Image(nsImage: image).resizable().scaledToFit()
        } else {
          Image(
            systemName: asset.kind == .video
              ? "play.rectangle" : asset.kind == .audio ? "waveform" : "doc.text"
          ).foregroundStyle(.secondary)
        }
      }.clipped().task(id: asset.id) {
        if asset.kind == .image { image = NSImage(contentsOf: url) }
      }.accessibilityLabel(asset.name)
    }
  }

  struct LibraryWorkspace: View {
    @ObservedObject var model: WorkspaceModel
    @State private var origin = "all"
    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          HStack {
            Text("Kho file").font(.title2.bold())
            Spacer()
            Picker("Loại", selection: $origin) {
              Text("Tất cả").tag("all")
              Text("Gốc").tag("input")
              Text("Trung gian").tag("intermediate")
              Text("Kết quả").tag("result")
            }.frame(width: 230)
            Button("Thêm nhạc / lời đọc") { Task { await model.importFiles(audio: true) } }
          }
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 200, maximum: 280))], spacing: 16) {
            ForEach(
              model.assets.filter { origin == "all" || $0.origin.rawValue == origin }.reversed()
            ) { asset in
              VStack(alignment: .leading, spacing: 8) {
                AssetThumbnail(asset: asset, url: model.fileURL(asset)).frame(height: 145)
                  .onTapGesture { NSWorkspace.shared.open(model.fileURL(asset)) }
                Text(asset.name).lineLimit(1)
                Text(
                  "\(asset.origin.rawValue) · \(ByteCountFormatter.string(fromByteCount:Int64(asset.byteCount),countStyle:.file))"
                ).font(.caption).foregroundStyle(.secondary)
                HStack {
                  Button("Tải file") { Task { await model.export(asset) } }
                  Button("Hiện file") { model.reveal(asset) }
                  if asset.kind == .video {
                    Button("Hậu kỳ") {
                      model.finishVideoID = asset.id
                      model.page = .finishing
                    }
                  }
                }
              }.padding(12).background(
                Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12)
              )
              .onDrag { NSItemProvider(object: ("mooz-asset:" + asset.id) as NSString) }
            }
          }
        }.padding(22)
      }
    }
  }

  struct FinishingWorkspace: View {
    @ObservedObject var model: WorkspaceModel
    @State private var player: AVPlayer?
    var body: some View {
      HSplitView {
        VStack {
          if let player {
            VideoPlayer(player: player)
          } else {
            Text("Chọn video đã tạo hoặc nhập video từ Kho.").foregroundStyle(.secondary)
          }
        }.frame(minWidth: 530, maxWidth: .infinity, maxHeight: .infinity)
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            Text("Phòng hậu kỳ").font(.title2.bold())
            Picker("Video", selection: $model.finishVideoID) {
              Text("Chọn video").tag("")
              ForEach(model.assets.filter { $0.kind == .video }) { Text($0.name).tag($0.id) }
            }.onChange(of: model.finishVideoID) { _ in updatePlayer() }
            Button("Thêm video đang chọn vào danh sách ghép") {
              var clips = model.finishing.clipIDs ?? []
              if !model.finishVideoID.isEmpty { clips.append(model.finishVideoID) }
              model.finishing.clipIDs = clips
            }.disabled(model.finishVideoID.isEmpty || (model.finishing.clipIDs?.count ?? 0) >= 12)
            if let clips = model.finishing.clipIDs, !clips.isEmpty {
              ForEach(Array(clips.enumerated()), id: \.offset) { index, id in
                HStack {
                  Text("\(index+1). \(model.assets.first(where:{$0.id==id})?.name ?? "Thiếu clip")")
                    .font(.caption).lineLimit(1)
                  Spacer()
                  Button("↑") { model.finishing.clipIDs?.swapAt(index, index - 1) }.disabled(
                    index == 0)
                  Button("↓") { model.finishing.clipIDs?.swapAt(index, index + 1) }.disabled(
                    index == clips.count - 1)
                  Button("Bỏ") { model.finishing.clipIDs?.remove(at: index) }
                }
              }
              Text("Cắt theo thời gian của video sau khi ghép; bản gốc vẫn được giữ.").font(
                .caption
              ).foregroundStyle(.secondary)
            }
            HStack {
              TextField("Bắt đầu (giây)", value: $model.finishing.start, format: .number)
              TextField(
                "Kết thúc (giây)",
                text: Binding(
                  get: { model.finishing.end.map { String($0) } ?? "" },
                  set: { model.finishing.end = Double($0) }))
            }
            audioPicker("Nhạc", selection: $model.musicID)
            audioPicker("Lời đọc", selection: $model.voiceID)
            Button("Nhập nhạc / lời đọc") { Task { await model.importFiles(audio: true) } }
            Text("Âm lượng video").font(.caption)
            Slider(value: $model.finishing.originalVolume, in: 0...2)
            Text("Âm lượng nhạc").font(.caption)
            Slider(value: $model.finishing.musicVolume, in: 0...2)
            Text("Âm lượng lời đọc").font(.caption)
            Slider(value: $model.finishing.voiceVolume, in: 0...2)
            Text("Độ bão hòa màu").font(.caption)
            Slider(value: $model.finishing.saturation, in: 0...3)
            Text("Phụ đề SRT").font(.headline)
            TextEditor(text: $model.finishing.captions).frame(height: 170).font(
              .system(.body, design: .monospaced))
            Text("Bản gốc và clip từng cảnh được giữ. MP4 xuất sẽ thành file mới trong Kho.").font(
              .caption
            ).foregroundStyle(.secondary)
            Button {
              Task { await model.exportMovie() }
            } label: {
              HStack {
                if model.rendering { ProgressView().controlSize(.small) }
                Text(model.rendering ? "Đang dựng MP4…" : "Xuất MP4 hoàn chỉnh")
              }
            }.buttonStyle(.borderedProminent).disabled(
              model.rendering || model.finishVideoID.isEmpty || model.media == nil)
            if model.media == nil {
              Text(
                "Chưa có FFmpeg/ffprobe native. Cần gói app có công cụ media hoặc cài FFmpeg trên máy."
              ).font(.caption).foregroundStyle(.orange)
            }
          }.padding(22)
        }.frame(minWidth: 360, maxWidth: 470)
      }.onAppear { updatePlayer() }.onDisappear { player?.pause() }
        .onChange(of: model.finishing) { _ in model.finishingChanged() }
        .onChange(of: model.finishVideoID) { _ in model.finishingChanged() }
        .onChange(of: model.musicID) { _ in model.finishingChanged() }
        .onChange(of: model.voiceID) { _ in model.finishingChanged() }
    }
    private func audioPicker(_ title: String, selection: Binding<String>) -> some View {
      Picker(title, selection: selection) {
        Text("Không dùng").tag("")
        ForEach(model.assets.filter { $0.kind == .audio }) { Text($0.name).tag($0.id) }
      }
    }
    private func updatePlayer() {
      player?.pause()
      if let asset = model.assets.first(where: { $0.id == model.finishVideoID }) {
        player = AVPlayer(url: model.fileURL(asset))
      } else {
        player = nil
      }
    }
  }

  struct ConnectionWorkspace: View {
    @ObservedObject var model: WorkspaceModel
    @State private var provider = "openai"
    @State private var key = ""
    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          Text("Kết nối AI").font(.title2.bold())
          GroupBox("API") {
            VStack(alignment: .leading, spacing: 12) {
              Picker("Nhà cung cấp", selection: $provider) {
                Text("OpenAI").tag("openai")
                Text("Google").tag("google")
                Text("fal").tag("fal")
              }
              SecureField("API key — lưu trong macOS Keychain", text: $key)
              Button("Lưu khóa") {
                model.saveKey(key, provider: provider)
                key = ""
              }
              Text(
                "Chỉ gửi prompt và file khi bạn chạy hàng đợi. Tài khoản và hạn mức do dịch vụ AI cung cấp."
              ).font(.caption).foregroundStyle(.secondary)
            }.padding(10)
          }
          GroupBox("Chrome cùng máy") {
            VStack(alignment: .leading, spacing: 12) {
              Text("Cài MooZ Connect Native, tải lại tab AI, rồi dán mã ghép này vào extension.")
              Text(model.pairing.isEmpty ? "Chưa mở được cổng kết nối Chrome." : model.pairing)
                .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
              HStack {
                Button("Sao chép mã ghép") {
                  NSPasteboard.general.clearContents()
                  NSPasteboard.general.setString(model.pairing, forType: .string)
                }.disabled(model.pairing.isEmpty)
                Button("Mở companion") {
                  if let path = Bundle.main.resourceURL?.appendingPathComponent("Companion") {
                    NSWorkspace.shared.open(path)
                  }
                }
                Button("Đọc tab") { Task { await model.refreshTabs() } }
              }
              ForEach(model.tabs) { Text("\($0.title) · tab \($0.id)").font(.caption) }
              Text(
                "Mỗi job giữ thiết bị, phiên Chrome, tab và cuộc trò chuyện đã chọn. Đổi tab không tự đổi job cũ."
              ).font(.caption).foregroundStyle(.secondary)
            }.padding(10)
          }
        }.padding(26).frame(maxWidth: 850, alignment: .leading)
      }.frame(maxWidth: .infinity, alignment: .leading)
    }
  }
#endif
