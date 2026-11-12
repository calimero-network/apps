// swift-tools-version: 5.9
// Mero Forum's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the typed contract client, the
// invitation codec, formatting, and the view models the SwiftUI screens bind.
//
// The swift-sdk pin must match the one in ../project.yml (one version for both).
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
        // swift-sdk release v4.1.0 (Calimero 1.0).
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            exact: "4.1.0"),
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
