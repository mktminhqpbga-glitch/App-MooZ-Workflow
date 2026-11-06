import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum ProviderHealth: Sendable { case ready, busy, unavailable(String) }
public enum ProviderFailure: Error { case notSent(String), busy(String), uncertain(String) }
public struct ProviderRequest: Sendable {
    public var job: Job
    public var scene: JobScene
    public var inputs: [(asset: Asset, data: Data)]
    public init(job: Job, scene: JobScene, inputs: [(Asset, Data)]) { self.job=job; self.scene=scene; self.inputs=inputs }
}
public struct GeneratedItem: Sendable {
    public var id: String
    public var mime: String
    public var data: Data?
    public var url: URL?
    public init(id: String, mime: String, data: Data? = nil, url: URL? = nil) { self.id=id; self.mime=mime; self.data=data; self.url=url }
}
public enum ProviderPoll: Sendable {
    case running(String)
    case output(items: [GeneratedItem], expected: Int, finished: Bool)
    case missing(String)
}
public struct SubmissionReceipt: Sendable {
    public var token: String
    public var initial: ProviderPoll?
    public init(token: String, initial: ProviderPoll? = nil) { self.token=token; self.initial=initial }
}
public protocol GenerationProvider: Sendable {
    func health(_ binding: TabBinding) async throws -> ProviderHealth
    /// Must throw notSent ONLY when no billable action occurred; all other failures are uncertain.
    func submit(_ request: ProviderRequest) async throws -> SubmissionReceipt
    func status(_ request: ProviderRequest) async throws -> ProviderPoll
    func acknowledge(_ request: ProviderRequest) async throws
}
public protocol MediaAssembling: Sendable {
    func assemble(_ clips: [URL]) async throws -> URL
    func discard(_ file: URL) async
}
public extension MediaAssembling { func discard(_ file: URL) async {} }

public actor GenerationQueue {
    private let store: WorkspaceStore
    private var providers: [String: any GenerationProvider]
    private let assembler: (any MediaAssembling)?
    public private(set) var enabled = false
    private var ticking = false
    public init(store: WorkspaceStore, providers: [String: any GenerationProvider], assembler: (any MediaAssembling)? = nil) {
        self.store=store; self.providers=providers; self.assembler=assembler
    }
    public func setEnabled(_ enabled: Bool) { self.enabled=enabled }
    public func register(_ provider: any GenerationProvider, id: String) { providers[id]=provider }
    public func tick(now: Date = Date()) async throws {
        guard !ticking else { return }
        ticking=true; defer { ticking=false }
        for var job in try await store.jobs() {
            guard ![.completed,.failed,.stopped].contains(job.state) else { continue }
            if job.state == .readyToAssemble {
                guard let assembler else { continue }
                do {
                    job.state = .assembling; try await store.updateJob(job)
                    let assets = try await store.assets()
                    let clips = try await job.scenes.asyncMap { scene -> URL in
                        guard let id=scene.outputIDs.first, let asset=assets.first(where:{$0.id==id}), asset.kind == .video else { throw MooZError.invalid("Cảnh còn thiếu clip thật.") }
                        _ = try await self.store.data(for:asset)
                        return try await self.store.fileURL(for:asset)
                    }
                    let output = try await assembler.assemble(clips)
                    defer { Task { await assembler.discard(output) } }
                    let bytes = try Data(contentsOf:output)
                    let asset = try await store.importAsset(data:bytes,name:job.title+".mp4",mime:"video/mp4",origin:.result,requestID:job.id,itemID:"final-mp4")
                    job.finalAssetID=asset.id; job.state = .completed; job.error=nil
                } catch { job.state = .readyToAssemble; job.error=error.localizedDescription }
                try await store.updateJob(job)
                continue
            }
            guard let index=job.scenes.firstIndex(where:{$0.state != .completed}) else { continue }
            guard let provider=providers[job.binding.provider] else {
                job.state = .waitingTab; job.error="Chưa cấu hình kết nối \(job.binding.provider)."; try await store.updateJob(job); continue
            }
            var request = try await makeRequest(job,index:index)
            if job.scenes[index].state == .persisted {
                do { try await provider.acknowledge(request); _ = try await store.acknowledge(jobID:job.id,sceneIndex:index,now:now) }
                catch { job.error="File đã lưu; đang chờ xác nhận: \(error.localizedDescription)"; try await store.updateJob(job) }
                continue
            }
            if [.sent,.collecting,.partial,.unknown].contains(job.scenes[index].state) {
                do { try await receive(try await provider.status(request),job:job,index:index,provider:provider,now:now) }
                catch {
                    job = try await store.job(job.id) ?? job
                    job.error="Chưa đối chiếu được: \(error.localizedDescription)"; try await store.updateJob(job)
                }
                continue
            }
            guard enabled, job.scenes[index].state == .queued else { continue }
            do {
                switch try await provider.health(job.binding) {
                case .busy:
                    job.state = .waitingTab; job.error="Đang chờ đúng tab đã chọn rảnh."; try await store.updateJob(job); continue
                case .unavailable(let reason):
                    job.state = .waitingTab; job.error=reason; try await store.updateJob(job); continue
                case .ready: break
                }
            } catch { job.state = .waitingTab; job.error=error.localizedDescription; try await store.updateJob(job); continue }
            guard let claimed=try await store.claim(jobID:job.id,sceneIndex:index,now:now) else {
                job = try await store.job(job.id) ?? job
                if [.queued,.waitingTab].contains(job.state) {
                    job.state = .waitingTab; job.error="Chờ tài nguyên hoặc nghỉ 10 giây sau khi lưu kết quả trước."; try await store.updateJob(job)
                }
                continue
            }
            job=claimed; request=try await makeRequest(job,index:index)
            do {
                let receipt=try await provider.submit(request)
                job.scenes[index].receipt=receipt.token; job.scenes[index].state = .sent; job.state = .sent; job.error=nil
                try await store.updateJob(job)
                if let initial=receipt.initial { try await receive(initial,job:job,index:index,provider:provider,now:now) }
            } catch ProviderFailure.busy(let reason) {
                job.scenes[index].state = .queued; job.state = .waitingTab; job.error=reason
                try await store.updateJob(job); try await store.releaseUnsent(job,sceneIndex:index)
            } catch ProviderFailure.notSent(let reason) {
                job.scenes[index].state = .queued; job.state = .failed; job.error=reason
                try await store.updateJob(job); try await store.releaseUnsent(job,sceneIndex:index)
            } catch {
                if let latest = try await store.job(job.id), latest.scenes[index].state != .dispatching {
                    // receive/ACK can fail after a newer durable manifest was committed. Never overwrite it with the stale pre-poll job.
                    job=latest; job.error=error.localizedDescription; try await store.updateJob(job); continue
                }
                // Claim was persisted before submit. A thrown response cannot prove that AI was not sent.
                job.scenes[index].state = .unknown; job.state = .unknown
                job.error="Lượt gửi chưa rõ kết quả. Đối chiếu \(job.scenes[index].requestID); không gửi lại."
                try await store.updateJob(job)
            }
        }
    }
    private func makeRequest(_ job: Job, index: Int) async throws -> ProviderRequest {
        var inputs: [(Asset,Data)] = []
        for asset in job.inputAssets where job.scenes[index].inputAssetIDs?.contains(asset.id) != false { inputs.append((asset,try await store.data(for:asset))) }
        return ProviderRequest(job:job,scene:job.scenes[index],inputs:inputs)
    }
    private func receive(_ poll: ProviderPoll, job original: Job, index: Int, provider: any GenerationProvider, now: Date) async throws {
        var job=original
        switch poll {
        case .running(let progress):
            job.state = .collecting; job.scenes[index].state = .collecting; job.error=progress
            try await store.updateJob(job)
        case .missing(let message):
            job.state = .unknown; job.scenes[index].state = .unknown; job.error=message
            try await store.updateJob(job)
        case .output(let items, let expected, let finished):
            guard expected > 0, expected <= 64, items.count <= 64, Set(items.map(\.id)).count == items.count else { throw MooZError.invalid("Manifest kết quả không hợp lệ.") }
            job.scenes[index].expectedItems=max(job.scenes[index].expectedItems ?? 0,expected)
            var errors: [String] = []
            for item in items {
                do {
                    let bytes=try await ArtifactDownload.data(item)
                    let format=try MediaSignature.inspect(bytes,mime:item.mime)
                    guard format.kind == job.settings.kind else { throw MooZError.invalid("Poster hoặc sai loại đầu ra.") }
                    guard !job.inputAssets.contains(where:{$0.sha256 == ContentHash.sha256(bytes)}) else { throw MooZError.invalid("Kết quả trùng ảnh đầu vào, không phải output mới.") }
                    let asset=try await store.importAsset(data:bytes,name:"\(job.title)-\(index+1)-\(item.id).\(format.extensionName)",mime:item.mime,origin:job.settings.kind == .video ? .intermediate : .result,requestID:job.scenes[index].requestID,itemID:item.id,sceneIndex:index+1)
                    if !job.scenes[index].outputIDs.contains(asset.id) { job.scenes[index].outputIDs.append(asset.id) }
                    try await store.updateJob(job)
                } catch { errors.append(error.localizedDescription) }
            }
            let complete = finished && errors.isEmpty && job.scenes[index].outputIDs.count == job.scenes[index].expectedItems
            job.scenes[index].state = complete ? .persisted : .partial
            job.state = complete ? .collecting : .partial
            job.error = errors.isEmpty ? (complete ? nil : "Đã lưu \(job.scenes[index].outputIDs.count)/\(job.scenes[index].expectedItems ?? expected) kết quả. Chưa gửi lại AI.") : errors.joined(separator:"\n")
            try await store.updateJob(job) // Durable manifest before ACK. Failed ACK retries only ACK.
            if complete {
                try await provider.acknowledge(try await makeRequest(job,index:index))
                _ = try await store.acknowledge(jobID:job.id,sceneIndex:index,now:now)
            }
        }
    }
}

public enum ArtifactDownload {
    public static func data(_ item: GeneratedItem) async throws -> Data {
        if let bytes=item.data { return bytes }
        guard let url=item.url, url.scheme == "https", url.user == nil, url.password == nil else { throw MooZError.invalid("URL media cần HTTPS; không đọc URL file hoặc gửi key tới CDN.") }
        var request=URLRequest(url:url); request.timeoutInterval=180
        let (data,response)=try await URLSession.shared.data(for:request)
        guard let http=response as? HTTPURLResponse, http.statusCode==200, data.count<=100*1_024*1_024,
              http.url?.scheme == "https" else { throw MooZError.invalid("Không tải được file kết quả hợp lệ.") }
        return data
    }
}
extension Array {
    func asyncMap<T>(_ transform: (Element) async throws -> T) async rethrows -> [T] {
        var result: [T] = []; for value in self { result.append(try await transform(value)) }; return result
    }
}
