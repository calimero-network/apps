// swift-tools-version: 5.9
// Mero Forum's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the generated contract client, the
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
        .library(name: "ForumCore", targets: ["ForumCore", "ForumGenerated"]),
    ],
    dependencies: [
        // main, the merge commit of swift-sdk#84 (app session).
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f"),
    ],
    targets: [
        // `node abi-codegen -i ../../logic/res/abi.json --target swift --client-name ForumClient`.
        // Its own module: it declares its own `ContextContractCalling`, which
        // would shadow MeroKit's in a module that imports both.
        .target(name: "ForumGenerated"),
        .target(
            name: "ForumCore",
            dependencies: [
                "ForumGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
            ]),
        .testTarget(
            name: "ForumCoreTests",
            dependencies: [
                "ForumCore",
                "ForumGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]),
    ]
)
