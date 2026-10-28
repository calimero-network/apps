// swift-tools-version: 5.9
// Mero Blocks' non-UI layer: the generated contract client, the bridge the game page calls the
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
        // feat/app-session (swift-sdk#84). Moves to the merge commit once that PR lands; keep it
        // equal to the revision in ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "551fc784e7545bcdbf358b4c348e6cd381b4512f"),
    ],
    targets: [
        // Generated/BlocksClient.swift comes from ../../../logic/res/abi.json
        // (../../scripts/regenerate.sh); never edit it by hand.
        .target(
            name: "BlocksCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "BlocksCoreTests",
            dependencies: [
                "BlocksCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
