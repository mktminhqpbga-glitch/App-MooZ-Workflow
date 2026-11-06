import XCTest
@testable import MooZCore

final class MediaTests: XCTestCase {
    func testAssemblesRealSceneClipsInOrderAndFinishesWithMusicAndCaptions() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:root) }
        let tools=try NativeMediaTools()
        let red=root.appendingPathComponent("red.mp4"), blue=root.appendingPathComponent("blue.mp4"), music=root.appendingPathComponent("music.wav")
        for (file,color) in [(red,"red"),(blue,"blue")] {
            _ = try await ProcessExecutor.run(tools.ffmpeg,arguments:["-v","error","-f","lavfi","-i","color=c=\(color):s=96x64:r=24:d=1","-c:v","libx264","-pix_fmt","yuv420p",file.path])
        }
        _ = try await ProcessExecutor.run(tools.ffmpeg,arguments:["-v","error","-f","lavfi","-i","sine=frequency=700:duration=3",music.path])
        let joined=try await tools.assemble([red,blue])
        let metadata=try await tools.inspect(joined)
        XCTAssertEqual(metadata.streams.first(where:{$0.codec_type=="video"})?.codec_name,"h264")
        XCTAssertEqual(metadata.duration,2,accuracy:0.08)
        for (time,channel) in [("0.2",0),("1.2",2)] {
            let pixels=try await ProcessExecutor.run(tools.ffmpeg,arguments:["-v","error","-ss",time,"-i",joined.path,"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"])
            XCTAssertGreaterThan(Int(pixels[channel]),Int(pixels[channel==0 ? 2 : 0])+100,"Clip order is retained")
        }
        var settings=FinishingSettings(); settings.start=0.2; settings.end=1.5
        settings.captions="1\n00:00:00,000 --> 00:00:01,000\nMooZ native\n"
        let finished=try await tools.finish(joined,music:music,settings:settings)
        let final=try await tools.inspect(finished)
        XCTAssertEqual(final.duration,1.3,accuracy:0.08)
        XCTAssertTrue(final.streams.contains(where:{$0.codec_type=="audio" && $0.codec_name=="aac"}))
        XCTAssertTrue(FileManager.default.fileExists(atPath:red.path))
    }
}
