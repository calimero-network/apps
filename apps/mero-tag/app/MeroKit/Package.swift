// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MeroKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v13), // so `swift test` runs on the Mac without a simulator
    ],
    products: [
        .library(name: "MeroKit", targets: ["MeroKit"]),
        .executable(name: "merokit-verify", targets: ["MeroKitVerify"]),
    ],
    targets: [
        .target(name: "MeroKit"),
        // XCTest suite — runs in Xcode and CI (`swift test` needs full Xcode).
        .testTarget(name: "MeroKitTests", dependencies: ["MeroKit"]),
        // No-Xcode smoke test of the pure logic — `swift run merokit-verify`
        // works with only Command Line Tools installed.
        .executableTarget(name: "MeroKitVerify", dependencies: ["MeroKit"]),
    ]
)
