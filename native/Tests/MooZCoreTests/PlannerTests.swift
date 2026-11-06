import XCTest

@testable import MooZCore

final class PlannerTests: XCTestCase {
  func testAliasesIgnoreEmailsEscapesAndCodeButRejectDanglingReferences() throws {
    let references = [Reference("a", role: .product, alias: "anh1")]
    let text = try PromptReferences.compile(
      "mail@example.com @@anh2 `@anh3` @ANH1", references: references, inputOrder: ["a"])
    XCTAssertTrue(text.hasPrefix("mail@example.com @anh2 `@anh3` [Ảnh 1]"))
    XCTAssertThrowsError(
      try PromptReferences.compile("@anh2", references: references, inputOrder: ["a"]))
    XCTAssertThrowsError(
      try PromptReferences.compile("@anh1", references: references + references, inputOrder: ["a"]))
  }
  func testCombinedProductRetainsEveryAngleAndCanvasWiresControlInputs() throws {
    var draft = BatchDraft()
    draft.prompts = ["Tạo sản phẩm"]
    draft.groups = [ProductGroup(name: "Hai góc", assetIDs: ["a", "b"])]
    let job = try BatchPlanner.plan(
      projectID: "p", draft: draft, assets: [Asset(id: "a", name: "a"), Asset(id: "b", name: "b")])[
        0]
    XCTAssertEqual(job.inputAssets.map(\.id), ["a", "b"])
    var graph = job.graph
    graph.edges.removeAll { $0.source == "input-b" }
    let compiled = try CanvasCompiler.compile(job, graph: graph)
    XCTAssertEqual(compiled.scenes[0].inputAssetIDs, ["a"])
    XCTAssertFalse(compiled.scenes[0].prompt.contains("Ảnh 2"))
    var cycle = job.graph
    cycle.edges.append(WorkflowEdge(job.scenes[0].id, "input-a"))
    XCTAssertThrowsError(try cycle.validate())
  }
  func testInvalidWholeBatchProducesNoPartialPlan() throws {
    var draft = BatchDraft()
    draft.prompts = ["@anh1"]
    draft.productSlots = [ProductSlot("anh1", imageIndex: 1)]
    draft.groups = [
      ProductGroup(name: "A", assetIDs: ["a", "b"]), ProductGroup(name: "B", assetIDs: ["b"]),
    ]
    XCTAssertThrowsError(
      try BatchPlanner.plan(
        projectID: "p", draft: draft,
        assets: [Asset(id: "a", name: "a"), Asset(id: "b", name: "b")]))
    draft.productSlots = []
    draft.prompts = ["Create"]
    draft.copies = 10
    XCTAssertThrowsError(
      try BatchPlanner.plan(projectID: "p", draft: draft, assets: [], existingJobs: 200))
  }
  func testThreeProductsTwoCopiesKeepRolesAndPerJobSlots() throws {
    let assets = ["hero", "cafe", "a", "b", "c"].map { Asset(id: $0, name: $0) }
    var draft = BatchDraft()
    draft.groups = ["a", "b", "c"].map { ProductGroup(id: $0, name: $0, assetIDs: [$0]) }
    draft.shared = [
      Reference("hero", role: .character, alias: "anh1"),
      Reference("cafe", role: .background, alias: "anh3"),
    ]
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
