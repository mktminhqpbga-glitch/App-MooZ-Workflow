import XCTest
@testable import MooZCore

final class PlannerTests: XCTestCase {
    func testThreeProductsTwoCopiesKeepRolesAndPerJobSlots() throws {
        let assets = ["hero", "cafe", "a", "b", "c"].map { Asset(id: $0, name: $0) }
        var draft = BatchDraft()
        draft.groups = ["a", "b", "c"].map { ProductGroup(id: $0, name: $0, assetIDs: [$0]) }
        draft.shared = [Reference("hero", role: .character, alias: "anh1"), Reference("cafe", role: .background, alias: "anh3")]
        draft.productSlots = [ProductSlot("anh2")]
        draft.prompts = ["@anh1 cầm @anh2 trong @anh3"]
        draft.copies = 2
        let jobs = try BatchPlanner.plan(projectID: "project", draft: draft, assets: assets)
        XCTAssertEqual(jobs.count, 6)
        XCTAssertEqual(jobs.map(\.groupID), ["a", "a", "b", "b", "c", "c"])
        for job in jobs {
            XCTAssertEqual(job.references.map(\.alias), ["anh1", "anh2", "anh3"])
            XCTAssertEqual(job.references.map(\.role), [.character, .product, .background])
            XCTAssertEqual(job.references[1].assetID, job.groupID)
            XCTAssertTrue(job.scenes[0].prompt.contains("[Ảnh 2]"))
        }
        XCTAssertEqual(Set(jobs.flatMap { $0.scenes.map(\.requestID) }).count, 6)
    }
}
