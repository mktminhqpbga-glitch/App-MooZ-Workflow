#if os(macOS)
import SwiftUI
import AppKit

@MainActor final class StartupState: ObservableObject {
    @Published var model:WorkspaceModel?
    @Published var error:String?
    init() {
        do {
            let folder=ProcessInfo.processInfo.environment["MOOZ_DATA_DIR"].map{URL(fileURLWithPath:$0,isDirectory:true)}
            model=try WorkspaceModel(root:folder)
            if CommandLine.arguments.contains("--smoke-test"),let model {Task{await NativeSmoke.run(model)}}
        }catch{self.error=error.localizedDescription}
    }
}
@main @MainActor struct MooZApp: App {
    @StateObject private var startup=StartupState()
    var body: some Scene {
        WindowGroup("MooZ") {
            if let model=startup.model { WorkspaceView(model:model).frame(minWidth:1_100,minHeight:720).preferredColorScheme(.dark) }
            else { VStack(spacing:16){Image(systemName:"externaldrive.badge.exclamationmark").font(.largeTitle);Text("Chưa mở được kho dữ liệu").font(.title2);Text(startup.error ?? "Lỗi không xác định.").textSelection(.enabled);Button("Thoát"){NSApplication.shared.terminate(nil)}}.padding(40) }
        }
        .defaultSize(width:1_500,height:950)
        .commands { CommandGroup(replacing:.newItem){Button("Dự án mới"){Task{await startup.model?.createProject("Dự án mới")}}.keyboardShortcut("n")} }
    }
}
#else
import Foundation
@main struct UnsupportedPlatform {
    static func main() { print("MooZ GUI requires macOS 13+. Use swift test to verify the portable core.") }
}
#endif
