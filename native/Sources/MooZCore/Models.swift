import Foundation

public enum MooZError: Error, LocalizedError, Equatable {
    case invalid(String), storage(String), unavailable(String), uncertain(String)
    public var errorDescription: String? {
        switch self { case .invalid(let s), .storage(let s), .unavailable(let s), .uncertain(let s): return s }
    }
}
public enum MediaKind: String, Codable, Sendable { case image, video, audio, text }
public enum AssetOrigin: String, Codable, Sendable { case input, intermediate, result }
public enum ReferenceRole: String, Codable, CaseIterable, Sendable { case product, character, background, style, reference }
public struct Asset: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var kind: MediaKind
    public var mimeType: String
    public var byteCount: Int
    public var sha256: String
    public var relativePath: String
    public var origin: AssetOrigin
    public var createdAt: Date
    public var requestID: String?
    public var itemID: String?
    public var sceneIndex: Int?
    public var projectID: String?
    public init(id: String = UUID().uuidString, name: String, kind: MediaKind = .image, mimeType: String = "image/png", byteCount: Int = 1, sha256: String = "", relativePath: String = "", origin: AssetOrigin = .input, createdAt: Date = Date(), requestID: String? = nil, itemID: String? = nil, sceneIndex: Int? = nil) {
        self.id=id; self.name=name; self.kind=kind; self.mimeType=mimeType; self.byteCount=byteCount; self.sha256=sha256; self.relativePath=relativePath; self.origin=origin; self.createdAt=createdAt; self.requestID=requestID; self.itemID=itemID; self.sceneIndex=sceneIndex
    }
}
public struct Reference: Codable, Hashable, Sendable {
    public var assetID: String
    public var role: ReferenceRole
    public var alias: String
    public init(_ assetID: String, role: ReferenceRole, alias: String) { self.assetID=assetID; self.role=role; self.alias=alias }
}
public struct ProductGroup: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var assetIDs: [String]
    public init(id: String = UUID().uuidString, name: String, assetIDs: [String]) { self.id=id; self.name=name; self.assetIDs=assetIDs }
}
public struct ProductSlot: Codable, Hashable, Sendable {
    public var alias: String
    public var imageIndex: Int
    public init(_ alias: String, imageIndex: Int = 0) { self.alias=alias; self.imageIndex=imageIndex }
}
public struct TabBinding: Codable, Hashable, Sendable {
    public var provider: String
    public var deviceID: String
    public var tabID: Int?
    public var epoch: String
    public var conversationURL: String?
    public var resource: String { tabID.map { "chrome:\(deviceID):\(epoch):\($0)" } ?? "api:\(provider)" }
    public init(provider: String, deviceID: String = "api", tabID: Int? = nil, epoch: String = "", conversationURL: String? = nil) { self.provider=provider; self.deviceID=deviceID; self.tabID=tabID; self.epoch=epoch; self.conversationURL=conversationURL }
}
public struct GenerationSettings: Codable, Hashable, Sendable {
    public var kind: MediaKind = .image
    public var model: String = "gpt-image-1"
    public var ratio: String = "1:1"
    public var resolution: String = "1024"
    public var quality: String = "medium"
    public var duration: Int = 8
    public var maxReferences: Int = 8
    public init(kind: MediaKind = .image, model: String = "gpt-image-1", ratio: String = "1:1", maxReferences: Int = 8) { self.kind=kind; self.model=model; self.ratio=ratio; self.maxReferences=maxReferences }
}
public struct BatchDraft: Codable, Hashable, Sendable {
    public var groups: [ProductGroup] = []
    public var shared: [Reference] = []
    public var productSlots: [ProductSlot] = []
    public var prompts: [String] = []
    public var copies: Int = 1
    public var scenePrompts: [String] = []
    public var slotSequence: Int?
    public var productMode: String?
    public var binding = TabBinding(provider: "openai")
    public var settings = GenerationSettings()
    public init() {}
}
public enum SceneState: String, Codable, Sendable { case queued, dispatching, sent, collecting, partial, persisted, completed, unknown, failed }
public struct JobScene: Codable, Identifiable, Hashable, Sendable {
    public var id: String { requestID }
    public var requestID = UUID().uuidString
    public var index: Int
    public var prompt: String
    public var state: SceneState = .queued
    public var outputIDs: [String] = []
    public var receipt: String?
    public var acknowledgedAt: Date?
    public var expectedItems: Int?
    public var sourcePrompt: String?
    public var inputAssetIDs: [String]?
    public var requestCode: String?
    public init(index: Int, prompt: String) {
        self.index=index; self.prompt=prompt
        requestCode="MZ-"+UUID().uuidString.replacingOccurrences(of:"-",with:"").lowercased()
    }
    public func wirePrompt(kind:MediaKind) -> String {
        guard let code=requestCode else{return prompt}
        let instruction=kind == .text ? "Ở dòng đầu câu trả lời văn bản, ghi [MOOZ_REPLY:\(code)]." : "Đây là mã đối chiếu của ứng dụng. Không vẽ/in mã lên ảnh hoặc video."
        return "[MOOZ_REQUEST:\(code)]\n\(instruction)\n\n\(prompt)"
    }
}
public enum JobState: String, Codable, Sendable { case queued, waitingTab, dispatching, sent, collecting, partial, unknown, assembling, readyToAssemble, completed, failed, stopped }
public struct Job: Codable, Identifiable, Hashable, Sendable {
    public var id = UUID().uuidString
    public var projectID: String
    public var groupID: String
    public var title: String
    public var originalPrompt: String
    public var copy: Int
    public var references: [Reference]
    public var inputAssets: [Asset]
    public var settings: GenerationSettings
    public var binding: TabBinding
    public var scenes: [JobScene]
    public var state: JobState = .queued
    public var error: String?
    public var finalAssetID: String?
    public var createdAt = Date()
    public var graph: WorkflowGraph = .init()
    public init(projectID: String, groupID: String, title: String, originalPrompt: String, copy: Int, references: [Reference], inputAssets: [Asset], settings: GenerationSettings, binding: TabBinding, scenes: [JobScene]) {
        self.projectID=projectID; self.groupID=groupID; self.title=title; self.originalPrompt=originalPrompt; self.copy=copy; self.references=references; self.inputAssets=inputAssets; self.settings=settings; self.binding=binding; self.scenes=scenes
    }
}
public struct WorkflowNode: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var kind: String
    public var x: Double
    public var y: Double
    public var assetID: String?
    public init(id: String = UUID().uuidString, title: String, kind: String, x: Double, y: Double, assetID: String? = nil) { self.id=id; self.title=title; self.kind=kind; self.x=x; self.y=y; self.assetID=assetID }
}
public struct WorkflowEdge: Codable, Hashable, Sendable {
    public var source: String
    public var target: String
    public init(_ source: String, _ target: String) { self.source=source; self.target=target }
}
public struct WorkflowGraph: Codable, Hashable, Sendable {
    public var nodes: [WorkflowNode] = []
    public var edges: [WorkflowEdge] = []
    public init() {}
}
public struct Project: Codable, Identifiable, Hashable, Sendable {
    public var id = UUID().uuidString
    public var name: String
    public var revision = 1
    public var draft = BatchDraft()
    public var graph = WorkflowGraph()
    public var createdAt = Date()
    public init(name: String) { self.name=name }
    public var previewJobs: [Job]?
    public var finishing: FinishingSettings?
}
