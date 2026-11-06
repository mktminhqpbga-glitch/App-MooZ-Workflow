import Foundation

public enum BatchPlanner {
    public static func plan(projectID: String, draft: BatchDraft, assets: [Asset], existingJobs: Int = 0) throws -> [Job] {
        guard (1...10).contains(draft.copies), (1...50).contains(draft.prompts.count),
              draft.prompts.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.count <= 20_000 }),
              draft.scenePrompts.count <= 12, draft.settings.maxReferences >= 0,
              !draft.settings.model.isEmpty else { throw MooZError.invalid("Prompt, model, số bản tạo hoặc số cảnh không hợp lệ.") }
        guard Set(assets.map(\.id)).count == assets.count else { throw MooZError.invalid("Asset ID bị trùng.") }
        let byID = Dictionary(uniqueKeysWithValues: assets.map { ($0.id, $0) })
        let groups = draft.groups.isEmpty ? [ProductGroup(id: "text-only", name: "Văn bản", assetIDs: [])] : draft.groups
        guard Set(groups.map(\.id)).count == groups.count,
              groups.count <= 200, existingJobs >= 0,
              groups.count * draft.prompts.count * draft.copies + existingJobs <= 200 else {
            throw MooZError.invalid("Hàng đợi tối đa 200 tác vụ; nhóm sản phẩm không được trùng.")
        }
        var jobs: [Job] = []
        var snapshots: [String: Int] = [:]
        for group in groups {
            guard (draft.groups.isEmpty || !group.assetIDs.isEmpty), Set(group.assetIDs).count == group.assetIDs.count else {
                throw MooZError.invalid("Nhóm sản phẩm rỗng hoặc lặp ảnh.")
            }
            var refs = draft.shared
            let explicit = draft.productSlots
            for (index, id) in group.assetIDs.enumerated() {
                let aliases = explicit.filter { $0.imageIndex == index }.map(\.alias)
                if aliases.isEmpty {
                    var number = 1
                    while refs.contains(where: { $0.alias.lowercased() == "anh\(number)" }) || explicit.contains(where: { $0.alias.lowercased() == "anh\(number)" }) { number += 1 }
                    refs.append(Reference(id, role: .product, alias: "anh\(number)"))
                } else {
                    refs += aliases.map { Reference(id, role: .product, alias: $0) }
                }
            }
            guard explicit.allSatisfy({ group.assetIDs.indices.contains($0.imageIndex) }) else {
                throw MooZError.invalid("Slot ảnh sản phẩm không tồn tại trong nhóm \(group.name).")
            }
            refs.sort { $0.alias.localizedStandardCompare($1.alias) == .orderedAscending }
            guard Set(refs.map { $0.alias.lowercased() }).count == refs.count,
                  refs.allSatisfy({ $0.alias.range(of: "^[a-zA-Z][a-zA-Z0-9_-]{0,31}$", options: .regularExpression) != nil }) else {
                throw MooZError.invalid("Thẻ ảnh bị trùng hoặc không hợp lệ.")
            }
            var inputs: [Asset] = []
            for ref in refs {
                guard let asset = byID[ref.assetID], asset.kind == .image, asset.byteCount > 0,
                      asset.byteCount <= 8 * 1_024 * 1_024, ["image/png", "image/jpeg", "image/webp"].contains(asset.mimeType) else {
                    throw MooZError.invalid("Ảnh @\(ref.alias) bị thiếu, sai định dạng hoặc vượt 8 MB.")
                }
                if !inputs.contains(where: { $0.id == asset.id }) { inputs.append(asset) }
                snapshots[asset.id] = asset.byteCount
            }
            guard inputs.count <= min(8, draft.settings.maxReferences), snapshots.values.reduce(0, +) <= 32 * 1_024 * 1_024 else {
                throw MooZError.invalid("Vượt số ảnh model hỗ trợ hoặc snapshot vượt 32 MB. Không bỏ bớt ảnh để gửi.")
            }
            for prompt in draft.prompts {
                let scenes = draft.scenePrompts.isEmpty ? [prompt] : draft.scenePrompts
                for copy in 1...draft.copies {
                    let compiled = try scenes.enumerated().map { index, scene in
                        let text = draft.scenePrompts.isEmpty ? scene : prompt + "\n\n" + scene
                        var scene = JobScene(index: index + 1, prompt: try PromptReferences.compile(text, references: refs, inputOrder: inputs.map(\.id)))
                        scene.sourcePrompt=text; scene.inputAssetIDs=inputs.map(\.id)
                        return scene
                    }
                    var job = Job(projectID: projectID, groupID: group.id, title: "\(group.name) · \(copy)", originalPrompt: prompt, copy: copy, references: refs, inputAssets: inputs, settings: draft.settings, binding: draft.binding, scenes: compiled)
                    job.graph = WorkflowGraph.forJob(job)
                    jobs.append(job)
                }
            }
        }
        return jobs
    }
}

public enum PromptReferences {
    /// Email addresses, escaped @@ and inline code are never interpreted as reference chips.
    public static func compile(_ prompt: String, references: [Reference], inputOrder: [String]) throws -> String {
        let aliases = Dictionary(uniqueKeysWithValues: references.map { ($0.alias.lowercased(), $0.assetID) })
        let characters = Array(prompt)
        var result = "", index = 0, inCode = false
        func word(_ c: Character) -> Bool { c.isLetter || c.isNumber || c == "_" || c == "-" }
        while index < characters.count {
            let char = characters[index]
            if char == "`" { inCode.toggle(); result.append(char); index += 1; continue }
            if !inCode && char == "@" && index + 1 < characters.count {
                if characters[index + 1] == "@" { result.append("@"); index += 2; continue }
                if index == 0 || !word(characters[index - 1]) {
                    var end = index + 1
                    while end < characters.count && word(characters[end]) { end += 1 }
                    if end > index + 1 {
                        let alias = String(characters[(index + 1)..<end]).lowercased()
                        guard let id = aliases[alias], let position = inputOrder.firstIndex(of: id) else {
                            throw MooZError.invalid("Không tìm thấy thẻ @\(alias). Chưa tạo tác vụ nào.")
                        }
                        result += "[Ảnh \(position + 1)]"; index = end; continue
                    }
                }
            }
            result.append(char); index += 1
        }
        if !references.isEmpty {
            result += "\n\nVai trò ảnh: " + references.map { ref in
                "Ảnh \((inputOrder.firstIndex(of: ref.assetID) ?? 0) + 1) = \(ref.role.rawValue) (@\(ref.alias))"
            }.joined(separator: "; ")
        }
        return result
    }
}

extension WorkflowGraph {
    public static func forJob(_ job: Job) -> Self {
        var graph = Self()
        for (i, asset) in job.inputAssets.enumerated() {
            graph.nodes.append(WorkflowNode(id: "input-\(asset.id)", title: asset.name, kind: "imageInput", x: 70, y: Double(i * 160 + 60), assetID: asset.id))
        }
        for (i, scene) in job.scenes.enumerated() {
            let kind = job.settings.kind == .image ? "generateImage" : job.settings.kind == .text ? "generateText" : "generateVideo"
            graph.nodes.append(WorkflowNode(id: scene.requestID, title: "Cảnh \(scene.index)", kind: kind, x: Double(400 + i * 300), y: 120))
            graph.edges += job.inputAssets.map { WorkflowEdge("input-\($0.id)", scene.requestID) }
        }
        if job.settings.kind == .video {
            graph.nodes.append(WorkflowNode(id: "final-\(job.id)", title: "MP4 thành phẩm", kind: "assembleVideo", x: Double(400 + job.scenes.count * 300), y: 120))
            graph.edges += job.scenes.map { WorkflowEdge($0.requestID, "final-\(job.id)") }
        }
        return graph
    }

    public func validate() throws {
        let ids = Set(nodes.map(\.id))
        guard ids.count == nodes.count, nodes.count <= 1_000,
              nodes.allSatisfy({ $0.x.isFinite && $0.y.isFinite }), edges.count <= 5_000,
              Set(edges).count == edges.count, edges.allSatisfy({ ids.contains($0.source) && ids.contains($0.target) && $0.source != $0.target }) else {
            throw MooZError.invalid("Node hoặc dây nối không hợp lệ.")
        }
        var visited: Set<String> = [], visiting: Set<String> = []
        func visit(_ id: String) throws {
            if visiting.contains(id) { throw MooZError.invalid("Workflow có vòng lặp.") }
            if visited.contains(id) { return }
            visiting.insert(id)
            for edge in edges where edge.source == id { try visit(edge.target) }
            visiting.remove(id); visited.insert(id)
        }
        for node in nodes { try visit(node.id) }
    }
}
