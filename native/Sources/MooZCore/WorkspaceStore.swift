import Foundation
#if canImport(ImageIO)
import ImageIO
#endif

public actor WorkspaceStore {
    public let root: URL
    private let db: SQLiteDatabase
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    public init(root: URL) throws {
        self.root = root.standardizedFileURL
        try FileManager.default.createDirectory(at: root.appendingPathComponent("media"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        let file = root.appendingPathComponent("workspace.sqlite")
        db = try SQLiteDatabase(file: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    private func put<T: Encodable>(_ value: T, kind: String, id: String) throws {
        let text = String(decoding: try encoder.encode(value), as: UTF8.self)
        try db.execute("INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload", values: [kind,id,text])
    }
    private func get<T: Decodable>(_ type: T.Type, kind: String, id: String) throws -> T? {
        guard let row = try db.rows("SELECT payload FROM records WHERE kind=? AND id=?", values: [kind,id]).first else { return nil }
        return try decoder.decode(type, from: Data(row[0].utf8))
    }
    private func all<T: Decodable>(_ type: T.Type, kind: String) throws -> [T] {
        try db.rows("SELECT payload FROM records WHERE kind=? ORDER BY rowid", values: [kind]).map { try decoder.decode(type, from: Data($0[0].utf8)) }
    }
    public func saveProject(_ project: Project) throws -> Project {
        guard !project.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw MooZError.invalid("Tên dự án không được trống.") }
        try project.graph.validate()
        return try db.transaction {
            var saved = project
            if let old = try get(Project.self, kind: "project", id: project.id) {
                guard old.revision == project.revision else { throw MooZError.storage("Dự án đã đổi. Tải lại trước khi ghi đè.") }
                saved.revision += 1
            }
            try put(saved, kind: "project", id: saved.id)
            return saved
        }
    }
    public func projects() throws -> [Project] { try all(Project.self, kind: "project") }
    public func saveDraft(projectID:String,draft:BatchDraft,preview:[Job],finishing:FinishingSettings) throws -> Project {
        try db.transaction {
            guard var project=try get(Project.self,kind:"project",id:projectID) else{throw MooZError.invalid("Dự án không còn tồn tại.")}
            project.draft=draft;project.previewJobs=preview;project.finishing=finishing;project.revision+=1
            if let graph=preview.first?.graph{project.graph=graph}
            try put(project,kind:"project",id:projectID)
            return project
        }
    }
    public func assets() throws -> [Asset] { try all(Asset.self, kind: "asset") }
    public func jobs(projectID: String? = nil) throws -> [Job] {
        try all(Job.self, kind: "job").filter { projectID == nil || $0.projectID == projectID }.sorted { $0.createdAt < $1.createdAt }
    }
    public func job(_ id: String) throws -> Job? { try get(Job.self, kind: "job", id: id) }
    public func updateJob(_ job: Job) throws {
        guard try self.job(job.id) != nil else { throw MooZError.invalid("Không tìm thấy tác vụ.") }
        try put(job, kind: "job", id: job.id)
    }
    public func enqueue(_ jobs: [Job]) throws {
        try db.transaction {
            guard !jobs.isEmpty, try self.jobs().count + jobs.count <= 200, Set(jobs.map(\.id)).count == jobs.count else {
                throw MooZError.invalid("Đợt tác vụ rỗng, trùng ID hoặc vượt 200 job.")
            }
            for job in jobs {
                guard try self.job(job.id) == nil, try get(Project.self, kind: "project", id: job.projectID) != nil else {
                    throw MooZError.invalid("Tác vụ bị trùng hoặc dự án không còn tồn tại.")
                }
                try job.graph.validate()
                for asset in job.inputAssets { _ = try data(for: asset) }
                try put(job, kind: "job", id: job.id)
            }
        }
    }
    public func importAsset(data: Data, name: String, mime: String, origin: AssetOrigin = .input, requestID: String? = nil, itemID: String? = nil, sceneIndex: Int? = nil) throws -> Asset {
        let format = try MediaSignature.inspect(data, mime: mime)
        let hash = ContentHash.sha256(data)
        let id: String
        if let requestID, let itemID { id = "result-" + ContentHash.sha256(Data((requestID + "\u{0}" + itemID).utf8)) }
        else { id = UUID().uuidString }
        if let old = try get(Asset.self, kind: "asset", id: id) {
            guard old.sha256 == hash, old.mimeType == mime else { throw MooZError.invalid("Cùng item ID nhưng nội dung kết quả đã đổi.") }
            _ = try self.data(for: old)
            return old
        }
        let path = "media/\(hash).\(format.extensionName)"
        let destination = root.appendingPathComponent(path)
        if FileManager.default.fileExists(atPath: destination.path) {
            guard ContentHash.sha256(try Data(contentsOf: destination)) == hash else { throw MooZError.storage("File trong Kho hỏng checksum.") }
        } else {
            try data.write(to: destination, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
            let handle = try FileHandle(forWritingTo: destination)
            try handle.synchronize(); try handle.close()
        }
        let asset = Asset(id: id, name: String(name.prefix(200)), kind: format.kind, mimeType: mime, byteCount: data.count, sha256: hash, relativePath: path, origin: origin, requestID: requestID, itemID: itemID, sceneIndex: sceneIndex)
        try put(asset, kind: "asset", id: id)
        return asset
    }
    public func fileURL(for asset: Asset) throws -> URL {
        guard let saved = try get(Asset.self, kind: "asset", id: asset.id), saved.sha256 == asset.sha256,
              saved.relativePath.range(of: "^media/[a-f0-9]{64}\\.[a-z0-9]+$", options: .regularExpression) != nil else {
            throw MooZError.storage("Asset không thuộc Kho hoặc đường dẫn không hợp lệ.")
        }
        let file = root.appendingPathComponent(saved.relativePath)
        guard file.resolvingSymlinksInPath().path.hasPrefix(root.resolvingSymlinksInPath().path + "/media/"),
              try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
            throw MooZError.storage("Không đọc file liên kết ngoài Kho.")
        }
        return file
    }
    public func data(for asset: Asset) throws -> Data {
        let bytes = try Data(contentsOf: fileURL(for: asset), options: .mappedIfSafe)
        guard bytes.count == asset.byteCount, ContentHash.sha256(bytes) == asset.sha256 else { throw MooZError.storage("File thiếu hoặc sai checksum. Không báo tác vụ hoàn tất.") }
        return bytes
    }
    public func removeAsset(_ id: String) throws {
        guard !(try jobs()).contains(where: { $0.inputAssets.contains(where: { $0.id == id }) || $0.scenes.contains(where: { $0.outputIDs.contains(id) }) || $0.finalAssetID == id }) else {
            throw MooZError.invalid("File đang được tác vụ tham chiếu. Không xóa đầu vào hoặc checkpoint.")
        }
        try db.execute("DELETE FROM records WHERE kind='asset' AND id=?", values: [id])
    }
    public func cooldownUntil(_ resource: String) throws -> Date? {
        try db.rows("SELECT until FROM cooldowns WHERE resource=?", values: [resource]).first.flatMap { Double($0[0]) }.map(Date.init(timeIntervalSince1970:))
    }
    public func claim(jobID: String, sceneIndex: Int, now: Date) throws -> Job? {
        try db.transaction {
            guard var job = try self.job(jobID), job.scenes.indices.contains(sceneIndex), job.scenes[sceneIndex].state == .queued,
                  [.queued,.waitingTab].contains(job.state) else { return nil }
            if let until = try cooldownUntil(job.binding.resource), until > now { return nil }
            if let lease = try db.rows("SELECT job,request FROM leases WHERE resource=?", values: [job.binding.resource]).first,
               lease[0] != job.id || lease[1] != job.scenes[sceneIndex].requestID { return nil }
            try db.execute("INSERT INTO leases(resource,job,request) VALUES(?,?,?) ON CONFLICT(resource) DO UPDATE SET job=excluded.job,request=excluded.request", values: [job.binding.resource,job.id,job.scenes[sceneIndex].requestID])
            job.state = .dispatching; job.scenes[sceneIndex].state = .dispatching
            try put(job, kind: "job", id: job.id)
            return job
        }
    }
    public func releaseUnsent(_ job: Job, sceneIndex: Int) throws {
        guard job.scenes.indices.contains(sceneIndex), job.scenes[sceneIndex].receipt == nil,
              job.scenes[sceneIndex].state == .queued else { throw MooZError.uncertain("Lượt đã gửi/chưa rõ; không tự mở khóa tab.") }
        try db.execute("DELETE FROM leases WHERE job=? AND request=?", values: [job.id,job.scenes[sceneIndex].requestID])
    }
    public func acknowledge(jobID: String, sceneIndex: Int, now: Date) throws -> Job {
        try db.transaction {
            guard var job = try self.job(jobID), job.scenes.indices.contains(sceneIndex), job.scenes[sceneIndex].state == .persisted else {
                throw MooZError.invalid("Chỉ ACK khi các file đã lưu đủ.")
            }
            job.scenes[sceneIndex].state = .completed; job.scenes[sceneIndex].acknowledgedAt = now
            if job.scenes.allSatisfy({ $0.state == .completed }) {
                job.state = job.settings.kind == .video ? .readyToAssemble : .completed
                if job.settings.kind != .video { job.finalAssetID = job.scenes.first?.outputIDs.first }
            } else { job.state = .queued }
            job.error = nil
            try put(job, kind: "job", id: job.id)
            try db.execute("DELETE FROM leases WHERE job=? AND request=?", values: [job.id,job.scenes[sceneIndex].requestID])
            try db.execute("INSERT INTO cooldowns(resource,until) VALUES(?,?) ON CONFLICT(resource) DO UPDATE SET until=excluded.until", values: [job.binding.resource,String(now.addingTimeInterval(10).timeIntervalSince1970)])
            return job
        }
    }
    public func recoverInterrupted() throws {
        try db.transaction {
            for var job in try jobs() {
                for i in job.scenes.indices where [.dispatching,.sent].contains(job.scenes[i].state) {
                    job.scenes[i].state = .unknown; job.state = .unknown
                    job.error = "Phiên trước bị gián đoạn. Đối chiếu đúng request ID; không gửi lại."
                }
                if job.state == .assembling { job.state = .readyToAssemble }
                try put(job, kind: "job", id: job.id)
            }
        }
    }
}

public enum MediaSignature {
    public static func inspect(_ data: Data, mime: String) throws -> (kind: MediaKind, extensionName: String) {
        guard !data.isEmpty, data.count <= 100 * 1_024 * 1_024 else { throw MooZError.invalid("File rỗng hoặc vượt 100 MB.") }
        let b = Array(data.prefix(40))
        if mime == "image/png", b.count >= 24, Array(b.prefix(8)) == [137,80,78,71,13,10,26,10], String(bytes: b[12..<16], encoding: .ascii) == "IHDR" {
            try validatePNG(data)
            #if canImport(ImageIO)
            guard let source=CGImageSourceCreateWithData(data as CFData,nil),CGImageSourceCreateImageAtIndex(source,0,nil) != nil else {throw MooZError.invalid("PNG không giải mã được.")}
            #endif
            return (.image,"png")
        }
        if mime == "image/jpeg", b.starts(with: [255,216,255]), data.suffix(2) == Data([255,217]) { return (.image,"jpg") }
        if mime == "image/webp", b.count >= 16, String(bytes:b[0..<4],encoding:.ascii)=="RIFF", String(bytes:b[8..<12],encoding:.ascii)=="WEBP" { return (.image,"webp") }
        if mime == "video/mp4", b.count >= 12, String(bytes:b[4..<8],encoding:.ascii)=="ftyp" { return (.video,"mp4") }
        if mime == "audio/wav", b.count >= 12, String(bytes:b[0..<4],encoding:.ascii)=="RIFF", String(bytes:b[8..<12],encoding:.ascii)=="WAVE" { return (.audio,"wav") }
        if mime == "audio/mpeg", b.count >= 3, (String(bytes:b[0..<3],encoding:.ascii)=="ID3" || b[0]==255 && b[1]&224==224) { return (.audio,"mp3") }
        if mime == "text/plain", String(data:data,encoding:.utf8) != nil { return (.text,"txt") }
        throw MooZError.invalid("Nội dung file không khớp định dạng \(mime); không dùng poster/HTML làm thành phẩm.")
    }
    private static func validatePNG(_ data:Data) throws {
        let bytes=Array(data)
        func number(_ i:Int)->UInt32 { UInt32(bytes[i])<<24 | UInt32(bytes[i+1])<<16 | UInt32(bytes[i+2])<<8 | UInt32(bytes[i+3]) }
        var offset=8,foundData=false,foundEnd=false
        while offset+12<=bytes.count {
            let count=Int(number(offset))
            guard count<=bytes.count-offset-12 else{throw MooZError.invalid("PNG bị cắt giữa chunk.")}
            let name=String(bytes:bytes[(offset+4)..<(offset+8)],encoding:.ascii) ?? ""
            var crc:UInt32=0xffffffff
            for byte in bytes[(offset+4)..<(offset+8+count)] {
                crc ^= UInt32(byte)
                for _ in 0..<8 {crc = crc&1==1 ? (crc>>1)^0xedb88320 : crc>>1}
            }
            guard crc^0xffffffff==number(offset+8+count) else{throw MooZError.invalid("PNG sai CRC.")}
            if offset==8 {
                guard name=="IHDR",count==13,number(16)>0,number(20)>0,UInt64(number(16))*UInt64(number(20))<=100_000_000 else{throw MooZError.invalid("Kích thước PNG không hợp lệ.")}
            }
            if name=="IDAT"{foundData=true}
            offset += count+12
            if name=="IEND"{guard count==0,offset==bytes.count else{throw MooZError.invalid("PNG có phần kết thúc không hợp lệ.")};foundEnd=true;break}
        }
        guard foundData,foundEnd else{throw MooZError.invalid("PNG chưa có dữ liệu ảnh và IEND hoàn chỉnh.")}
    }
}
