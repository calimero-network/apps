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
        // swift-sdk release v0.7.0; keep it equal to the version in ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", exact: "0.7.0"),
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
