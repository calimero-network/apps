// swift-tools-version: 5.9
// Hyperfeed Forum's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the typed contract client, the
// invitation codec, formatting, and the view models the SwiftUI screens bind.
//
// The MeroKit pin must match the one in ../project.yml (one version for both).
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
        // MeroKit from a calimero-network/core release (Calimero 1.0).
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.38"),
    ],
    targets: [
        .target(
            name: "ForumCore",
            dependencies: [
                .product(name: "MeroKit", package: "core"),
            ]),
        .testTarget(
            name: "ForumCoreTests",
            dependencies: [
                "ForumCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]),
    ]
)
