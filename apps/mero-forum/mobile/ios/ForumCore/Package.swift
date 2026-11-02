// swift-tools-version: 5.9
// Mero Forum's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the typed contract client, the
// invitation codec, formatting, and the view models the SwiftUI screens bind.
//
// The swift-sdk pin must match the one in ../project.yml (one revision for both).
import PackageDescription

let package = Package(
    name: "ForumCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "ForumCore", targets: ["ForumCore"]),
    ],
    dependencies: [
        // swift-sdk's Calimero 1.0 port (swift-sdk#85) at 37c09f3; moves to its merge commit once it lands.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "37c09f3f96e7d98440f6618eef8a0e83ddee8ebd"),
    ],
    targets: [
        .target(
            name: "ForumCore",
            dependencies: [
                .product(name: "MeroKit", package: "swift-sdk"),
            ]),
        .testTarget(
            name: "ForumCoreTests",
            dependencies: [
                "ForumCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]),
    ]
)
