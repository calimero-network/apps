// swift-tools-version: 5.9
// Merraria's non-UI layer: the generated contract client, the world list, invitations, the
// JS bridge to the bundled game and the touch-control mapping. A plain SwiftPM package so
// `swift build` / `swift test` run it on macOS with no simulator; the app (project.yml) links it
// as a local package.
import PackageDescription

let package = Package(
    name: "MerrariaCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "MerrariaCore", targets: ["MerrariaCore"]),
    ],
    dependencies: [
        // The main merge commit of swift-sdk#84; keep it equal to the revision in ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f"),
    ],
    targets: [
        // Sources/MerrariaCore/Generated is written by ../../scripts/regenerate.sh from the
        // contract's ABI. Never edit it by hand.
        .target(
            name: "MerrariaCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "MerrariaCoreTests",
            dependencies: [
                "MerrariaCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
