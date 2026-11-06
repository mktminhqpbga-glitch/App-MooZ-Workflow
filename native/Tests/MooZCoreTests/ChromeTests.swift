import XCTest
@testable import MooZCore

private actor ChromeFixture: ChromeTransport {
    var identityValue=ChromeIdentity(deviceID:"d",epoch:"e",connected:true)
    var url="https://chatgpt.com/c/one"
    var result:[String:Any]=[:]
    var sent=true
    var calls:[String]=[]
    func setIdentity(_ value:ChromeIdentity){identityValue=value}
    func setResult(_ value:[String:Any],url:String?=nil){result=value;if let url{self.url=url}}
    func identity() async -> ChromeIdentity {identityValue}
    func request(_ operation:String,payload:Data) async throws -> Data {
        calls.append(operation)
        if operation=="tabs.get"{return try JSONSerialization.data(withJSONObject:["id":17,"url":url])}
        return try JSONSerialization.data(withJSONObject:["ok":true,"state":"done","result":result])
    }
    func register(requestID:String,tabID:Int,provider:String) async throws -> String{"token"}
    func finish(requestID:String) async throws{}
    func wasSent(requestID:String) async -> Bool{sent}
    func callCount()->Int{calls.count}
}

final class ChromeTests:XCTestCase {
    private func request() throws -> ProviderRequest {
        var draft=BatchDraft();draft.prompts=["Tạo ảnh"]
        draft.binding=TabBinding(provider:"chatgpt",deviceID:"d",tabID:17,epoch:"e",conversationURL:"https://chatgpt.com/c/one")
        let job=try BatchPlanner.plan(projectID:"p",draft:draft,assets:[])[0]
        return ProviderRequest(job:job,scene:job.scenes[0],inputs:[])
    }
    func testSameTabNeedsCorrectNonceAndReceiptAndRestartPreservesCode() async throws {
        let req=try request(), transport=ChromeFixture(),provider=ChromeProvider(transport:transport)
        let restored=try JSONDecoder().decode(Job.self,from:JSONEncoder().encode(req.job))
        XCTAssertEqual(restored.scenes[0].requestCode,req.scene.requestCode)
        XCTAssertNotEqual(req.scene.requestCode,try request().scene.requestCode)
        var result:[String:Any]=["ok":true,"requestId":req.scene.requestID,"items":[["id":"i","url":"data:image/png;base64,"+StorageTests.pixel.base64EncodedString()]],"chatURL":"https://chatgpt.com/c/one"]
        result["receipt"]=["requestId":req.scene.requestID,"requestCode":"wrong","sentTurnMatchesRequestId":true]
        await transport.setResult(result)
        if case .missing = try await provider.status(req){}else{XCTFail("Same URL must not bypass nonce evidence")}
        result["receipt"]=["requestId":req.scene.requestID,"requestCode":req.scene.requestCode!,"sentTurnMatchesRequestId":true]
        await transport.setResult(result)
        if case .output(let items,let expected,let finished)=try await provider.status(req){XCTAssertEqual(items.count,1);XCTAssertEqual(expected,1);XCTAssertTrue(finished)}else{XCTFail("Exact receipt should reconcile")}
        await transport.setIdentity(ChromeIdentity(deviceID:"d",epoch:"another-session",connected:true))
        let before=await transport.callCount()
        if case .missing = try await provider.status(req){}else{XCTFail("Reused tab ID in another epoch must wait")}
        let after=await transport.callCount();XCTAssertEqual(before,after)
    }
    func testConversationCanonicalizationPreservesIdentityAndNewChatNeedsProof() {
        XCTAssertEqual(ConversationIdentity.canonical("https://chatgpt.com/c/one/?theme=dark&hl=vi"),"https://chatgpt.com/c/one")
        XCTAssertNotEqual(ConversationIdentity.canonical("https://muse.ai/chat?id=one"),ConversationIdentity.canonical("https://muse.ai/chat?id=two"))
        XCTAssertFalse(ConversationIdentity.accepts(initial:"https://chatgpt.com/c/one",actual:"https://chatgpt.com/c/two",attested:"https://chatgpt.com/c/two",requestID:"r",receiptID:"r",sent:true))
        XCTAssertFalse(ConversationIdentity.accepts(initial:"https://chatgpt.com/",actual:"https://chatgpt.com/c/two",attested:nil,requestID:"r",receiptID:"r",sent:true))
        XCTAssertTrue(ConversationIdentity.accepts(initial:"https://chatgpt.com/",actual:"https://chatgpt.com/c/two",attested:"https://chatgpt.com/c/two",requestID:"r",receiptID:"r",sent:true))
    }
}
