import Foundation

public struct ChromeIdentity: Codable, Hashable, Sendable {
    public var deviceID: String
    public var epoch: String
    public var connected: Bool
    public init(deviceID:String,epoch:String,connected:Bool) { self.deviceID=deviceID;self.epoch=epoch;self.connected=connected }
}
public struct ChromeTab: Codable, Identifiable, Sendable {
    public var id: Int
    public var title: String
    public var url: String
    public init(id:Int,title:String,url:String){self.id=id;self.title=title;self.url=url}
}
public protocol ChromeTransport: Sendable {
    func identity() async -> ChromeIdentity
    func request(_ operation: String, payload: Data) async throws -> Data
    func register(requestID: String, tabID: Int, provider: String) async throws -> String
    func finish(requestID: String) async throws
    func wasSent(requestID: String) async -> Bool
}
public enum ConversationIdentity {
    public static func provider(_ value:String) -> String? {
        guard let c=URLComponents(string:value),c.scheme=="https",c.user==nil,c.password==nil,c.port==nil,let host=c.host?.lowercased() else { return nil }
        if ["chatgpt.com","www.chatgpt.com","chat.openai.com"].contains(host) { return "chatgpt" }
        if host=="muse.ai" || host.hasSuffix(".muse.ai") { return "muse" }
        if host=="gemini.google.com" { return "gemini" }
        if ["grok.com","www.grok.com"].contains(host) { return "grok" }
        if host=="flow.google.com" || host=="labs.google" && c.path.contains("/tools/flow") { return "flow" }
        return nil
    }
    public static func canonical(_ value:String) -> String? {
        guard var c=URLComponents(string:value),provider(value) != nil else { return nil }
        c.host=c.host?.lowercased()
        while c.path.count>1 && c.path.hasSuffix("/") { c.path.removeLast() }
        c.queryItems=c.queryItems?.filter { !["hl","lang","theme","utm_source","utm_medium","utm_campaign"].contains($0.name.lowercased()) }.sorted { ($0.name,$0.value ?? "") < ($1.name,$1.value ?? "") }
        if c.queryItems?.isEmpty==true { c.queryItems=nil }
        return c.string
    }
    public static func accepts(initial:String,actual:String,attested:String?,requestID:String,receiptID:String?,sent:Bool) -> Bool {
        guard provider(initial)==provider(actual),let a=canonical(initial),let b=canonical(actual) else{return false}
        if a==b { return true }
        guard sent,receiptID==requestID,attested.flatMap(canonical)==b,let start=URLComponents(string:a),let end=URLComponents(string:b),start.host==end.host else{return false}
        let provisional=["/","/new","/chat","/chat/new","/app","/imagine"].contains(start.path)
        return provisional && start.path != end.path
    }
}

public actor ChromeProvider: GenerationProvider {
    private let transport: any ChromeTransport
    private var chats: [String:String] = [:]
    public init(transport:any ChromeTransport) { self.transport=transport }
    private func call(_ operation:String,_ object:[String:Any]) async throws -> [String:Any] {
        let bytes=try await transport.request(operation,payload:JSONSerialization.data(withJSONObject:object))
        guard let value=try JSONSerialization.jsonObject(with:bytes) as? [String:Any] else { throw MooZError.invalid("Chrome trả dữ liệu không hợp lệ.") }
        return value
    }
    public func tabs() async throws -> [ChromeTab] {
        let bytes=try await transport.request("tabs.query",payload:Data("{}".utf8))
        return try JSONDecoder().decode([ChromeTab].self,from:bytes).filter { ConversationIdentity.provider($0.url) != nil }
    }
    private func checkedTab(_ binding:TabBinding) async throws -> [String:Any] {
        let identity=await transport.identity()
        guard identity.connected,identity.deviceID==binding.deviceID,identity.epoch==binding.epoch,let id=binding.tabID else { throw MooZError.unavailable("Chờ đúng phiên Chrome đã chọn; không tự chuyển thiết bị/tab.") }
        let tab=try await call("tabs.get",["id":id])
        guard let url=tab["url"] as? String,ConversationIdentity.provider(url)==binding.provider else { throw MooZError.unavailable("Tab không còn thuộc AI đã chọn.") }
        let known=chats[binding.resource] ?? binding.conversationURL
        if let known,ConversationIdentity.canonical(known) != ConversationIdentity.canonical(url) { throw MooZError.unavailable("Cuộc trò chuyện khác. Đối chiếu lượt cũ trước khi chọn lại.") }
        return tab
    }
    public func health(_ binding:TabBinding) async throws -> ProviderHealth {
        do {
            _ = try await checkedTab(binding)
            let files=["ai-activity.js","composer-controls.js",binding.provider=="muse" ? "muse-bridge.js" : "ai-bridge.js"]
            _ = try await call("tabs.script",["id":binding.tabID!,"files":files])
            let value=try await call("tabs.message",["id":binding.tabID!,"message":["type":binding.provider=="muse" ? "MUSEFLOW_CHECK_SESSION" : "WORKFLOW_AI_CHECK"]])
            if value["busy"] as? Bool==true { return .busy }
            guard value["ok"] as? Bool==true,value["composer"] as? Bool==true,value["signedIn"] as? Bool != false,value["block"]==nil else { return .unavailable(value["error"] as? String ?? "Tab chưa đăng nhập/sẵn sàng hoặc dịch vụ đang chặn.") }
            return .ready
        } catch { return .unavailable(error.localizedDescription) }
    }
    public func submit(_ request:ProviderRequest) async throws -> SubmissionReceipt {
        let job=request.job, id=request.scene.requestID
        _ = try await checkedTab(job.binding)
        guard let tab=job.binding.tabID else { throw ProviderFailure.notSent("Thiếu tab Chrome.") }
        let token=try await transport.register(requestID:id,tabID:tab,provider:job.binding.provider)
        let message:[String:Any]=[
            "type":job.binding.provider=="muse" ? "MUSEFLOW_JOB_START" : "WORKFLOW_AI_JOB_START",
            "requestId":id,"provider":job.binding.provider,"mediaType":job.settings.kind.rawValue,
            "prompt":request.scene.wirePrompt(kind:job.settings.kind),"requestCode":request.scene.requestCode ?? "","size":job.settings.ratio,"resolution":job.settings.resolution,"quality":job.settings.quality,"duration":job.settings.duration,
            "referenceImages":request.inputs.map { "data:\($0.asset.mimeType);base64,\($0.data.base64EncodedString())" },
            "chatTarget":["tabId":tab,"url":chats[job.binding.resource] ?? job.binding.conversationURL ?? ""],
            "dispatchProtocol":1,"dispatchToken":token
        ]
        let value=try await call("tabs.message",["id":tab,"message":message])
        guard value["ok"] as? Bool==true else {
            if value["code"] as? String=="TAB_BUSY" { try await transport.finish(requestID:id); throw ProviderFailure.busy("Tab đang bận; chờ đúng tab.") }
            throw ProviderFailure.uncertain(value["error"] as? String ?? "Chưa xác nhận START; chỉ đọc STATUS, không tạo lại.")
        }
        return SubmissionReceipt(token:id)
    }
    public func status(_ request:ProviderRequest) async throws -> ProviderPoll {
        let binding=request.job.binding, id=request.scene.requestID, identity=await transport.identity()
        guard identity.connected,identity.deviceID==binding.deviceID,identity.epoch==binding.epoch,let tabID=binding.tabID else { return .missing("Chờ đúng Chrome/phiên để đối chiếu \(id).") }
        let value=try await call("tabs.message",["id":tabID,"message":["type":binding.provider=="muse" ? "MUSEFLOW_JOB_STATUS" : "WORKFLOW_AI_JOB_STATUS","requestId":id]])
        if value["state"] as? String=="running" { return .running(value["progress"] as? String ?? "AI đang tạo kết quả.") }
        guard let result=value["result"] as? [String:Any],result["ok"] as? Bool==true,result["requestId"] as? String==id else { return .missing((value["result"] as? [String:Any])?["error"] as? String ?? "Chưa có kết quả đúng request ID; không gửi lại.") }
        let tab=try await call("tabs.get",["id":tabID])
        let actual=tab["url"] as? String ?? ""
        let receipt=result["receipt"] as? [String:Any]
        let sent=await transport.wasSent(requestID:id)
        guard sent, receipt?["requestId"] as? String == id,
              receipt?["sentTurnMatchesRequestId"] as? Bool == true,
              let code=request.scene.requestCode, receipt?["requestCode"] as? String == code else {
            return .missing("Thiếu bằng chứng mã ngẫu nhiên trong đúng lượt đã gửi. Không nhận kết quả chỉ dựa vào tab hoặc request ID.")
        }
        guard ConversationIdentity.accepts(initial:chats[binding.resource] ?? binding.conversationURL ?? actual,actual:actual,attested:(result["chatURL"] ?? result["conversationUrl"]) as? String,requestID:id,receiptID:receipt?["requestId"] as? String,sent:sent && receipt?["sentTurnMatchesRequestId"] as? Bool==true) else { return .missing("Chưa xác minh cùng cuộc trò chuyện và lượt gửi. Không nhận nhầm file.") }
        chats[binding.resource]=actual
        if request.job.settings.kind == .text,let text=result["text"] as? String {
            let marker="[MOOZ_REPLY:\(code)]"
            guard text.trimmingCharacters(in:.whitespacesAndNewlines).hasPrefix(marker) else { return .missing("Văn bản chưa trả đúng mã đối chiếu; giữ lượt cũ để kiểm tra.") }
            let clean=text.trimmingCharacters(in:.whitespacesAndNewlines).dropFirst(marker.count).trimmingCharacters(in:.whitespacesAndNewlines)
            guard !clean.isEmpty else{return .missing("Câu trả lời chỉ có mã, chưa có nội dung.")}
            return .output(items:[GeneratedItem(id:"text",mime:"text/plain",data:Data(clean.utf8))],expected:1,finished:true)
        }
        let rows=result["items"] as? [[String:Any]] ?? []
        var items:[GeneratedItem]=[]
        for row in rows {
            guard let itemID=row["id"] as? String,let source=row["url"] as? String,let range=source.range(of:";base64,"),source.hasPrefix("data:"),let bytes=Data(base64Encoded:String(source[range.upperBound...])) else { continue }
            let mime=String(source[source.index(source.startIndex,offsetBy:5)..<range.lowerBound])
            items.append(GeneratedItem(id:itemID,mime:mime,data:bytes))
        }
        guard !items.isEmpty else { return .missing("Bridge chưa có manifest file thực. Cập nhật companion native rồi tải lại tab; không gửi lại job cũ.") }
        return .output(items:items,expected:result["expectedItems"] as? Int ?? items.count,finished:result["partial"] as? Bool != true)
    }
    public func acknowledge(_ request:ProviderRequest) async throws {
        guard let tab=request.job.binding.tabID else { throw MooZError.invalid("Thiếu tab để ACK.") }
        let value=try await call("tabs.message",["id":tab,"message":["type":request.job.binding.provider=="muse" ? "MUSEFLOW_JOB_ACK" : "WORKFLOW_AI_JOB_ACK","requestId":request.scene.requestID]])
        guard value["ok"] as? Bool==true else { throw MooZError.unavailable("Companion chưa ACK.") }
        try await transport.finish(requestID:request.scene.requestID)
    }
}
