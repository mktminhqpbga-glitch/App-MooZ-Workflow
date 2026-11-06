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
    .systemLibrary(
      name: "CSQLite", pkgConfig: "sqlite3",
      providers: [.apt(["libsqlite3-dev"]), .brew(["sqlite3"])]),
    .target(name: "MooZCore", dependencies: ["CSQLite"]),
    .executableTarget(name: "MooZApp", dependencies: ["MooZCore"]),
    .testTarget(name: "MooZCoreTests", dependencies: ["MooZCore"]),
  ],
  swiftLanguageModes: [.v5]
)
