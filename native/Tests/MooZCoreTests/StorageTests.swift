import XCTest
@testable import MooZCore

final class StorageTests: XCTestCase {
    static let pixel = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")!
    func testTruncatedImageHeaderIsNotAnAsset() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:root)}
        let store=try WorkspaceStore(root:root)
        do{_ = try await store.importAsset(data:Self.pixel.prefix(24),name:"broken.png",mime:"image/png");XCTFail("A header is not a decodable image")}catch{}
        let assets=try await store.assets();XCTAssertTrue(assets.isEmpty)
    }
    func testProjectAndOriginalFileSurviveReopen() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try WorkspaceStore(root: root)
        var project = Project(name: "Sản phẩm A")
        project.draft.prompts = ["Giữ nhãn sản phẩm"]
        let saved = try await first.saveProject(project)
        let input = try await first.importAsset(data: Self.pixel, name: "original.png", mime: "image/png")
        let reopened = try WorkspaceStore(root: root)
        let projects = try await reopened.projects()
        let bytes = try await reopened.data(for: input)
        let assets = try await reopened.assets()
        XCTAssertEqual(projects.first?.id, saved.id)
        XCTAssertEqual(projects.first?.draft.prompts, ["Giữ nhãn sản phẩm"])
        XCTAssertEqual(bytes, Self.pixel)
        XCTAssertEqual(assets.count, 1)
    }
}
