// swift-tools-version: 5.9
// Hyperfeed Blocks' non-UI layer: the generated contract client, the bridge the game page calls the
// contract through, and the view models. A plain SwiftPM package so `swift build` / `swift test`
// run it on macOS with no simulator; the app (project.yml) links it as a local package.
import PackageDescription

let package = Package(
    name: "BlocksCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "BlocksCore", targets: ["BlocksCore"]),
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release; keep it equal to the version in
        // ../project.yml.
        .package(url: "https://github.com/calimero-network/core", exact: "1.0.0-rc.35"),
    ],
    targets: [
        // Sources/BlocksCore/Generated/BlocksClient.swift comes from ../../../logic/res/abi.json
        // (scripts/mobile-codegen.sh at the repo root); never edit it by hand.
        .target(
            name: "BlocksCore",
            dependencies: [.product(name: "MeroKit", package: "core")]
        ),
        .testTarget(
            name: "BlocksCoreTests",
            dependencies: [
                "BlocksCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]
        ),
    ]
)
