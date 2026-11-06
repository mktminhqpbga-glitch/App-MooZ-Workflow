import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct HTTPResult: Sendable {
    public var status: Int
    public var data: Data
    public init(status: Int, data: Data) { self.status=status; self.data=data }
}
public protocol HTTPTransport: Sendable { func send(_ request: URLRequest) async throws -> HTTPResult }
private final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
public final class NativeHTTPTransport: HTTPTransport, @unchecked Sendable {
    private let session: URLSession
    public init() { session=URLSession(configuration:.ephemeral,delegate:NoRedirects(),delegateQueue:nil) }
    public func send(_ request: URLRequest) async throws -> HTTPResult {
        guard request.url?.scheme=="https", request.url?.user==nil, request.url?.password==nil else { throw ProviderFailure.notSent("API cần HTTPS.") }
        let (bytes,response)=try await session.data(for:request)
        guard let http=response as? HTTPURLResponse, bytes.count<=100*1_024*1_024 else { throw ProviderFailure.uncertain("API không trả HTTP hoặc kết quả vượt 100 MB.") }
        return HTTPResult(status:http.statusCode,data:bytes)
    }
}

/// API adapters use the same immutable Job/Scene contract as the Chrome adapter.
public actor APIProvider: GenerationProvider {
    public enum Service: String, Sendable { case openai, google, fal }
    private let service: Service
    private let transport: any HTTPTransport
    private let key: @Sendable () async throws -> String
    private var received: [String:ProviderPoll] = [:]
    public init(service: Service, transport: any HTTPTransport = NativeHTTPTransport(), key: @escaping @Sendable () async throws -> String) {
        self.service=service; self.transport=transport; self.key=key
    }
    public func health(_ binding: TabBinding) async throws -> ProviderHealth {
        try await key().isEmpty ? .unavailable("Chưa có API key trong Keychain.") : .ready
    }
    private func json(_ url: String, method: String = "POST", value: [String:Any]? = nil, bytes: Data? = nil, contentType: String = "application/json") async throws -> [String:Any] {
        guard let url=URL(string:url),url.scheme=="https" else { throw ProviderFailure.notSent("Địa chỉ API không hợp lệ.") }
        let secret=try await key()
        guard !secret.isEmpty else { throw ProviderFailure.notSent("Chưa cấu hình API key.") }
        var request=URLRequest(url:url); request.httpMethod=method; request.timeoutInterval=240
        if service == .google { request.setValue(secret,forHTTPHeaderField:"x-goog-api-key") }
        else { request.setValue((service == .fal ? "Key " : "Bearer ")+secret,forHTTPHeaderField:"Authorization") }
        if method == "POST" { request.setValue(contentType,forHTTPHeaderField:"Content-Type"); request.httpBody=try bytes ?? value.map { try JSONSerialization.data(withJSONObject:$0) } }
        let response=try await transport.send(request)
        if [400,401,403,404,422,429].contains(response.status) { throw ProviderFailure.notSent("API từ chối HTTP \(response.status). Kiểm tra model, quyền và hạn mức; không tự lặp POST.") }
        guard (200..<300).contains(response.status),let object=try JSONSerialization.jsonObject(with:response.data) as? [String:Any] else { throw ProviderFailure.uncertain("API trả phản hồi chưa xác định. Không gửi lại prompt.") }
        return object
    }
    public func submit(_ request: ProviderRequest) async throws -> SubmissionReceipt {
        let settings=request.job.settings, refs=request.inputs
        guard refs.count<=settings.maxReferences, !settings.model.isEmpty,
              settings.model.range(of:"^[a-zA-Z0-9_./:-]{1,200}$",options:.regularExpression) != nil else { throw ProviderFailure.notSent("Model hoặc số ảnh không hợp lệ.") }
        let id=request.scene.requestID
        let prompt=request.scene.wirePrompt(kind:settings.kind)
        if service == .openai {
            if settings.kind == .image {
                let size: String
                switch settings.ratio { case "1:1": size="1024x1024"; case "2:3":size="1024x1536"; case "3:2":size="1536x1024"; default:throw ProviderFailure.notSent("OpenAI ảnh hiện hỗ trợ 1:1, 2:3, 3:2. Chọn đúng trước khi gửi.") }
                guard ["low","medium","high"].contains(settings.quality),settings.model.hasPrefix("gpt-image-") else { throw ProviderFailure.notSent("Model/chất lượng OpenAI ảnh chưa có adapter.") }
                let response: [String:Any]
                if refs.isEmpty {
                    response=try await json("https://api.openai.com/v1/images/generations",value:["model":settings.model,"prompt":prompt,"n":1,"size":size,"quality":settings.quality])
                } else {
                    let boundary="MooZ-"+UUID().uuidString
                    var body=Data()
                    for (name,value) in [("model",settings.model),("prompt",prompt),("n","1"),("size",size),("quality",settings.quality)] {
                        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
                    }
                    for (i,input) in refs.enumerated() {
                        let ext=input.asset.mimeType == "image/jpeg" ? "jpg" : input.asset.mimeType == "image/webp" ? "webp" : "png"
                        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"reference-\(i+1).\(ext)\"\r\nContent-Type: \(input.asset.mimeType)\r\n\r\n".utf8));body.append(input.data);body.append(Data("\r\n".utf8))
                    }
                    body.append(Data("--\(boundary)--\r\n".utf8))
                    response=try await json("https://api.openai.com/v1/images/edits",bytes:body,contentType:"multipart/form-data; boundary=\(boundary)")
                }
                let items=try decodeOpenAIImages(response)
                let output=ProviderPoll.output(items:items,expected:items.count,finished:true); received[id]=output
                return SubmissionReceipt(token:id,initial:output)
            }
            guard settings.kind == .text else { throw ProviderFailure.notSent("Adapter OpenAI này nhận văn bản/ảnh; video cần Veo/fal hoặc Chrome.") }
            let content:[[String:Any]] = [["type":"text","text":prompt]] + refs.map { ["type":"image_url","image_url":["url":"data:\($0.asset.mimeType);base64,\($0.data.base64EncodedString())"]] }
            let object=try await json("https://api.openai.com/v1/chat/completions",value:["model":settings.model,"messages":[["role":"user","content":content]]])
            guard let choices=object["choices"] as? [[String:Any]],let message=choices.first?["message"] as? [String:Any],let text=message["content"] as? String,!text.isEmpty else { throw ProviderFailure.uncertain("API chưa trả văn bản hợp lệ.") }
            let output=ProviderPoll.output(items:[GeneratedItem(id:"text",mime:"text/plain",data:Data(text.utf8))],expected:1,finished:true);received[id]=output
            return SubmissionReceipt(token:id,initial:output)
        }
        if service == .google {
            if settings.kind == .video {
                guard refs.count<=1,["16:9","9:16"].contains(settings.ratio),[4,6,8].contains(settings.duration),["720P","1080P"].contains(settings.resolution),settings.resolution != "1080P" || settings.duration==8,settings.model.hasPrefix("veo-") else { throw ProviderFailure.notSent("Veo: tối đa 1 ảnh mở đầu, 16:9/9:16, 4/6/8 giây; 1080P cần 8 giây.") }
                var instance:[String:Any]=["prompt":prompt]
                if let ref=refs.first { instance["image"]=["bytesBase64Encoded":ref.data.base64EncodedString(),"mimeType":ref.asset.mimeType] }
                let object=try await json("https://generativelanguage.googleapis.com/v1beta/models/\(settings.model):predictLongRunning",value:["instances":[instance],"parameters":["aspectRatio":settings.ratio,"durationSeconds":settings.duration,"resolution":settings.resolution.lowercased(),"numberOfVideos":1]])
                guard let name=object["name"] as? String, validOperation(name) else { throw ProviderFailure.uncertain("Veo chưa trả operation ID. Không gửi lại.") }
                return SubmissionReceipt(token:"google:"+name)
            }
            var parts:[[String:Any]]=[["text":prompt]]
            parts += refs.map { ["inlineData":["mimeType":$0.asset.mimeType,"data":$0.data.base64EncodedString()]] }
            var body:[String:Any]=["contents":[["role":"user","parts":parts]]]
            if settings.kind == .image { body["generationConfig"]=["responseModalities":["TEXT","IMAGE"],"imageConfig":["aspectRatio":settings.ratio]] }
            let response=try await json("https://generativelanguage.googleapis.com/v1beta/models/\(settings.model):generateContent",value:body)
            let candidates=response["candidates"] as? [[String:Any]] ?? []
            var items:[GeneratedItem]=[]
            for candidate in candidates {
                let content=candidate["content"] as? [String:Any] ?? [:]
                for part in content["parts"] as? [[String:Any]] ?? [] {
                    if let inline=part["inlineData"] as? [String:String],let mime=inline["mimeType"],let base64=inline["data"],let data=Data(base64Encoded:base64),settings.kind == .image { items.append(GeneratedItem(id:"part-\(items.count)",mime:mime,data:data)) }
                    if let text=part["text"] as? String,settings.kind == .text { items.append(GeneratedItem(id:"part-\(items.count)",mime:"text/plain",data:Data(text.utf8))) }
                }
            }
            guard !items.isEmpty else { throw ProviderFailure.uncertain("Gemini chưa trả đúng loại output.") }
            let output=ProviderPoll.output(items:items,expected:items.count,finished:true);received[id]=output
            return SubmissionReceipt(token:id,initial:output)
        }
        guard settings.kind == .video, refs.count<=1,["16:9","9:16"].contains(settings.ratio),[4,6,8].contains(settings.duration) else { throw ProviderFailure.notSent("Adapter fal native hiện dành cho Veo video với tối đa 1 ảnh mở đầu.") }
        let model=refs.isEmpty ? "fal-ai/veo3.1" : "fal-ai/veo3.1/image-to-video"
        guard settings.model==model else{throw ProviderFailure.notSent("Model fal đã chọn không khớp adapter \(model). Chọn lại model trước khi chạy.")}
        var body:[String:Any]=["prompt":prompt,"aspect_ratio":settings.ratio,"duration":"\(settings.duration)s","resolution":settings.resolution.lowercased()]
        if let ref=refs.first { body["image_url"]="data:\(ref.asset.mimeType);base64,\(ref.data.base64EncodedString())" }
        let object=try await json("https://queue.fal.run/"+model,value:body)
        guard let url=object["response_url"] as? String,validFal(url) else { throw ProviderFailure.uncertain("fal chưa trả request URL hợp lệ.") }
        return SubmissionReceipt(token:"fal:"+url)
    }
    public func status(_ request: ProviderRequest) async throws -> ProviderPoll {
        if let result=received[request.scene.requestID] { return result }
        guard let token=request.scene.receipt else { return .missing("Không có receipt. Nhập/đối chiếu kết quả thủ công; không gửi lại API.") }
        if service == .google,token.hasPrefix("google:") {
            let name=String(token.dropFirst(7));guard validOperation(name) else { throw MooZError.invalid("Operation ID không hợp lệ.") }
            let object=try await json("https://generativelanguage.googleapis.com/v1beta/"+name,method:"GET")
            if object["done"] as? Bool != true { return .running("Veo đang tạo video.") }
            if object["error"] != nil { return .missing("Veo báo lỗi operation; kiểm tra trước khi tạo lượt mới.") }
            let response=object["response"] as? [String:Any] ?? [:]
            let videoResponse=response["generateVideoResponse"] as? [String:Any] ?? response
            let samples=(videoResponse["generatedSamples"] ?? videoResponse["generatedVideos"]) as? [[String:Any]] ?? []
            var items:[GeneratedItem]=[]
            for (i,sample) in samples.enumerated() {
                let video=sample["video"] as? [String:Any] ?? sample
                if let base64=video["videoBytes"] as? String,let data=Data(base64Encoded:base64) { items.append(GeneratedItem(id:"video-\(i)",mime:"video/mp4",data:data));continue }
                if let value=(video["uri"] ?? video["downloadUri"]) as? String,let url=URL(string:value),url.scheme=="https",url.host=="generativelanguage.googleapis.com" {
                    var download=URLRequest(url:url);download.timeoutInterval=240;download.setValue(try await key(),forHTTPHeaderField:"x-goog-api-key")
                    let result=try await transport.send(download);guard result.status==200 else { throw MooZError.unavailable("Chưa tải được file Veo; giữ operation để thử đọc lại.") }
                    items.append(GeneratedItem(id:"video-\(i)",mime:"video/mp4",data:result.data))
                }
            }
            guard !items.isEmpty else { return .missing("Veo hoàn tất nhưng chưa nhận được clip thật.") }
            return .output(items:items,expected:items.count,finished:true)
        }
        if service == .fal,token.hasPrefix("fal:") {
            let url=String(token.dropFirst(4));guard validFal(url) else { throw MooZError.invalid("fal request URL không hợp lệ.") }
            let status=try await json(url+"/status",method:"GET")
            if status["status"] as? String != "COMPLETED" { return .running("fal đang xử lý; chưa gửi lại.") }
            let result=try await json(url,method:"GET")
            guard let video=result["video"] as? [String:Any],let string=video["url"] as? String,let output=URL(string:string) else { return .missing("fal chưa có file video.") }
            return .output(items:[GeneratedItem(id:"video",mime:"video/mp4",url:output)],expected:1,finished:true)
        }
        return .missing("API đồng bộ không có lịch sử để đọc lại sau restart. Đối chiếu/nhập file của lượt cũ, không phát lại POST.")
    }
    public func acknowledge(_ request: ProviderRequest) async throws { received.removeValue(forKey:request.scene.requestID) }
    private func validOperation(_ name:String)->Bool { !name.contains("..") && name.range(of:"^[a-zA-Z0-9_./-]{1,500}$",options:.regularExpression) != nil }
    private func validFal(_ string:String)->Bool { guard let url=URL(string:string) else{return false};return url.scheme=="https" && url.host=="queue.fal.run" && url.user==nil && url.password==nil && url.query==nil && url.fragment==nil && url.path.contains("/requests/") && !url.path.contains("..") }
    private func decodeOpenAIImages(_ object:[String:Any]) throws -> [GeneratedItem] {
        let rows=object["data"] as? [[String:Any]] ?? []
        let items=rows.enumerated().compactMap { i,row -> GeneratedItem? in
            if let base64=row["b64_json"] as? String,let data=Data(base64Encoded:base64) { return GeneratedItem(id:"image-\(i)",mime:"image/png",data:data) }
            if let string=row["url"] as? String,let url=URL(string:string) { return GeneratedItem(id:"image-\(i)",mime:"image/png",url:url) }
            return nil
        }
        guard !rows.isEmpty,items.count==rows.count else { throw ProviderFailure.uncertain("API trả ảnh thiếu dữ liệu; chưa đánh dấu hoàn tất.") }
        return items
    }
}
