import Foundation

public struct MediaMetadata: Codable, Sendable {
    public struct Stream: Codable, Sendable {
        public var codec_type: String?
        public var codec_name: String?
        public var width: Int?
        public var height: Int?
    }
    public struct Format: Codable, Sendable { public var duration: String? }
    public var streams: [Stream]
    public var format: Format?
    public var duration: Double { Double(format?.duration ?? "") ?? 0 }
}

public struct FinishingSettings: Codable, Hashable, Sendable {
    public var start: Double = 0
    public var end: Double?
    public var originalVolume: Double = 1
    public var musicVolume: Double = 0.3
    public var voiceVolume: Double = 1
    public var saturation: Double = 1
    public var captions: String = ""
    public init() {}
}

public struct NativeMediaTools: MediaAssembling, Sendable {
    public let ffmpeg: URL
    public let ffprobe: URL
    public init(ffmpeg: URL? = nil, ffprobe: URL? = nil) throws {
        self.ffmpeg = try ffmpeg ?? Self.find("ffmpeg")
        self.ffprobe = try ffprobe ?? Self.find("ffprobe")
    }
    public static func find(_ name: String) throws -> URL {
        let bundled: String? = Bundle.main.resourceURL.map { $0.appendingPathComponent("bin/"+name).path }
        let candidates: [String] = [bundled, "/opt/homebrew/bin/"+name, "/usr/local/bin/"+name, "/usr/bin/"+name].compactMap { $0 }
        guard let path=candidates.first(where:{FileManager.default.isExecutableFile(atPath:$0)}) else {
            throw MooZError.unavailable("Thiếu \(name) native. Cấu hình công cụ media trước khi xuất MP4.")
        }
        return URL(fileURLWithPath:path)
    }
    public func inspect(_ file: URL) async throws -> MediaMetadata {
        let bytes=try await ProcessExecutor.run(ffprobe,arguments:["-v","error","-show_streams","-show_format","-of","json",file.path])
        return try JSONDecoder().decode(MediaMetadata.self,from:bytes)
    }
    public func assemble(_ clips: [URL]) async throws -> URL {
        guard !clips.isEmpty, clips.count <= 12 else { throw MooZError.invalid("Cần từ 1 đến 12 clip, đúng thứ tự cảnh.") }
        let metadata = try await clips.asyncMap { try await inspect($0) }
        guard let first=metadata.first?.streams.first(where:{$0.codec_type=="video"}),
              let width=first.width, let height=first.height, width>0, height>0,
              metadata.allSatisfy({$0.duration.isFinite && $0.duration>0 && $0.streams.contains(where:{$0.codec_type=="video"})}) else { throw MooZError.invalid("Clip thiếu video hoặc thời lượng thật.") }
        let directory=try makeDirectory()
        do {
            let w=max(2,width/2*2), h=max(2,height/2*2)
            var args=["-v","error","-nostdin","-y"]
            for clip in clips { args += ["-i",clip.path] }
            var filters: [String]=[]
            for i in clips.indices {
                filters.append("[\(i):v]scale=\(w):\(h):force_original_aspect_ratio=decrease,pad=\(w):\(h):(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS[v\(i)]")
                if metadata[i].streams.contains(where:{$0.codec_type=="audio"}) {
                    filters.append("[\(i):a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=\(metadata[i].duration),asetpts=PTS-STARTPTS[a\(i)]")
                } else { filters.append("anullsrc=r=48000:cl=stereo,atrim=duration=\(metadata[i].duration)[a\(i)]") }
            }
            filters.append(clips.indices.map { "[v\($0)][a\($0)]" }.joined()+"concat=n=\(clips.count):v=1:a=1[video][audio]")
            let output=directory.appendingPathComponent("output.mp4")
            args += ["-filter_complex",filters.joined(separator:";"),"-map","[video]","-map","[audio]"]
            args += encodingArguments + [output.path]
            _ = try await ProcessExecutor.run(ffmpeg,arguments:args,directory:directory)
            try await verifyMP4(output, duration:metadata.map(\.duration).reduce(0,+), audio:true)
            return output
        } catch { try? FileManager.default.removeItem(at:directory); throw error }
    }
    public func finish(_ video: URL, music: URL? = nil, voice: URL? = nil, settings: FinishingSettings) async throws -> URL {
        let source=try await inspect(video), duration=(settings.end ?? source.duration)-settings.start
        guard settings.start.isFinite, settings.start>=0, duration.isFinite, duration>0,
              settings.start+duration<=source.duration+0.02,
              [settings.originalVolume,settings.musicVolume,settings.voiceVolume].allSatisfy({$0.isFinite && (0...2).contains($0)}),
              settings.saturation.isFinite, (0...3).contains(settings.saturation),settings.captions.utf8.count<=500_000 else { throw MooZError.invalid("Đoạn cắt, âm lượng, màu hoặc phụ đề không hợp lệ.") }
        let directory=try makeDirectory()
        do {
            var args=["-v","error","-nostdin","-y","-ss",String(settings.start),"-i",video.path]
            var audioFilters: [String]=[], audioLabels: [String]=[]
            if source.streams.contains(where:{$0.codec_type=="audio"}) {
                audioFilters.append("[0:a]atrim=duration=\(duration),asetpts=PTS-STARTPTS,volume=\(settings.originalVolume)[original]"); audioLabels.append("[original]")
            }
            var nextInput=1
            if let music {
                _ = try await inspect(music)
                args += ["-stream_loop","-1","-i",music.path]
                audioFilters.append("[\(nextInput):a]atrim=duration=\(duration),asetpts=PTS-STARTPTS,volume=\(settings.musicVolume)[music]"); audioLabels.append("[music]"); nextInput += 1
            }
            if let voice {
                _ = try await inspect(voice)
                args += ["-i",voice.path]
                audioFilters.append("[\(nextInput):a]apad,atrim=duration=\(duration),asetpts=PTS-STARTPTS,volume=\(settings.voiceVolume)[voice]"); audioLabels.append("[voice]")
            }
            if !audioLabels.isEmpty {
                audioFilters.append(audioLabels.joined()+"amix=inputs=\(audioLabels.count):duration=longest:normalize=0,atrim=duration=\(duration)[audio]")
                args += ["-filter_complex",audioFilters.joined(separator:";"),"-map","0:v:0","-map","[audio]"]
            } else { args += ["-map","0:v:0","-an"] }
            var videoFilter="eq=saturation=\(settings.saturation)"
            if !settings.captions.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
                try settings.captions.write(to:directory.appendingPathComponent("captions.srt"),atomically:true,encoding:.utf8)
                videoFilter += ",subtitles=captions.srt"
            }
            let output=directory.appendingPathComponent("output.mp4")
            args += ["-vf",videoFilter,"-t",String(duration)] + encodingArguments + [output.path]
            _ = try await ProcessExecutor.run(ffmpeg,arguments:args,directory:directory)
            try await verifyMP4(output,duration:duration,audio:!audioLabels.isEmpty)
            return output
        } catch { try? FileManager.default.removeItem(at:directory); throw error }
    }
    private var encodingArguments: [String] { ["-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-ar","48000","-movflags","+faststart"] }
    private func makeDirectory() throws -> URL {
        let url=FileManager.default.temporaryDirectory.appendingPathComponent("mooz-render-"+UUID().uuidString)
        try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true)
        return url
    }
    private func verifyMP4(_ file: URL, duration: Double, audio: Bool) async throws {
        let result=try await inspect(file)
        guard result.streams.contains(where:{$0.codec_type=="video" && $0.codec_name=="h264"}),
              abs(result.duration-duration)<0.15,
              !audio || result.streams.contains(where:{$0.codec_type=="audio" && $0.codec_name=="aac"}) else { throw MooZError.invalid("MP4 chưa đạt codec, thời lượng hoặc audio yêu cầu.") }
        // Decode the entire result, not only its container header.
        _ = try await ProcessExecutor.run(ffmpeg,arguments:["-v","error","-xerror","-i",file.path,"-f","null","-"])
    }
    public func discard(_ file: URL) async {
        let folder=file.deletingLastPathComponent().standardizedFileURL
        if folder.lastPathComponent.hasPrefix("mooz-render-"), folder.deletingLastPathComponent()==FileManager.default.temporaryDirectory.standardizedFileURL { try? FileManager.default.removeItem(at:folder) }
    }
}

private final class RunningProcess: @unchecked Sendable {
    private let lock=NSLock()
    private var process: Process?
    private var cancelled=false
    func attach(_ process: Process) throws {
        lock.lock(); defer { lock.unlock() }
        if cancelled { throw CancellationError() }; self.process=process
        try process.run()
    }
    func cancel() { lock.lock(); defer { lock.unlock() }; cancelled=true; if let process, process.isRunning { process.terminate() } }
    var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
}
private final class ProcessErrorOutput: @unchecked Sendable {
    private let lock=NSLock(); private var bytes=Data()
    func set(_ data: Data) { lock.lock(); bytes=Data(data.suffix(4_000)); lock.unlock() }
    func text() -> String { lock.lock(); defer { lock.unlock() }; return String(decoding:bytes,as:UTF8.self) }
}
public enum ProcessExecutor {
    /// No shell is involved. Pipes drain concurrently; task cancellation terminates only this child.
    public static func run(_ executable: URL, arguments: [String], directory: URL? = nil) async throws -> Data {
        let box=RunningProcess()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos:.userInitiated).async {
                    let process=Process(), output=Pipe(), errors=Pipe(), errorData=ProcessErrorOutput()
                    process.executableURL=executable; process.arguments=arguments; process.currentDirectoryURL=directory
                    process.standardOutput=output; process.standardError=errors
                    do {
                        try box.attach(process)
                        let group=DispatchGroup(); group.enter()
                        DispatchQueue.global().async { errorData.set(errors.fileHandleForReading.readDataToEndOfFile()); group.leave() }
                        let bytes=output.fileHandleForReading.readDataToEndOfFile()
                        process.waitUntilExit(); group.wait()
                        if box.isCancelled { throw CancellationError() }
                        guard process.terminationStatus==0 else { throw MooZError.invalid("\(executable.lastPathComponent): \(errorData.text())") }
                        continuation.resume(returning:bytes)
                    } catch { continuation.resume(throwing:error) }
                }
            }
        }, onCancel: { box.cancel() })
    }
}
