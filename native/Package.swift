// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "MooZNative",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "MooZCore", targets: ["MooZCore"]),
    .executable(name: "MooZ", targets: ["MooZApp"]),
  ],
  targets: [
    // Use the SDK/system SQLite. pkg-config on a Mac build host can select a
    // Homebrew dylib that is absent (or requires a newer OS) on the user's Mac.
    .systemLibrary(name: "CSQLite"),
    .target(name: "MooZCore", dependencies: ["CSQLite"]),
    .executableTarget(name: "MooZApp", dependencies: ["MooZCore"]),
    .testTarget(name: "MooZCoreTests", dependencies: ["MooZCore"]),
  ],
  swiftLanguageModes: [.v5]
)
