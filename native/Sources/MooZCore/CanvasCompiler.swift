import Foundation

/// Canvas and Batch persist the same Job. Wires determine exactly which images reach each scene.
public enum CanvasCompiler {
    public static func compile(_ original: Job, graph: WorkflowGraph) throws -> Job {
        try graph.validate()
        let generators=graph.nodes.filter { ["generateImage","generateVideo","generateText"].contains($0.kind) }
        guard Set(generators.map(\.id)) == Set(original.scenes.map(\.requestID)) else {
            throw MooZError.invalid("Các bước Canvas không khớp kế hoạch cảnh. Tạo lại kế hoạch trước khi chạy.")
        }
        var job=original
        for i in job.scenes.indices {
            let sourceIDs=graph.edges.filter { $0.target==job.scenes[i].requestID }.map(\.source)
            let nodes=sourceIDs.compactMap { id in graph.nodes.first { $0.id==id } }
            guard nodes.allSatisfy({$0.kind=="imageInput" && $0.assetID != nil}) else {
                throw MooZError.invalid("Bước tạo chỉ nhận ảnh từ cổng ảnh. Dây nối không được tự đổi kiểu dữ liệu.")
            }
            let ids=Set(nodes.compactMap(\.assetID))
            guard ids.isSubset(of:Set(original.inputAssets.map(\.id))) else { throw MooZError.invalid("Canvas tham chiếu ảnh ngoài snapshot kế hoạch.") }
            let order=original.inputAssets.filter { ids.contains($0.id) }.map(\.id)
            let refs=original.references.filter { ids.contains($0.assetID) }
            job.scenes[i].prompt=try PromptReferences.compile(job.scenes[i].sourcePrompt ?? job.originalPrompt,references:refs,inputOrder:order)
            job.scenes[i].inputAssetIDs=order
        }
        if job.settings.kind == .video {
            let final="final-"+job.id
            guard graph.nodes.contains(where:{$0.id==final && $0.kind=="assembleVideo"}),
                  Set(graph.edges.filter{$0.target==final}.map(\.source))==Set(job.scenes.map(\.requestID)) else {
                throw MooZError.invalid("Phải nối đủ các clip vào MP4 thành phẩm. Thứ tự ghép theo số cảnh.")
            }
        }
        job.graph=graph
        return job
    }
}
