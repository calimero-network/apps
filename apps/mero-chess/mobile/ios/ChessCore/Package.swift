// swift-tools-version: 5.9
// Mero Chess's non-UI layer: the generated contract client, the board helpers and the view
// models. A plain SwiftPM package so `swift build` / `swift test` run it on macOS with no
// simulator; the app (project.yml) links it as a local package.
import PackageDescription

let package = Package(
    name: "ChessCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "ChessCore", targets: ["ChessCore"]),
    ],
    dependencies: [
        // main, the merge commit of swift-sdk#84 (app session); keep it equal to the revision in
        // ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f"),
    ],
    targets: [
        // Generated from ../../../logic/res/abi.json by @calimero/abi-codegen. Never edit by hand:
        // ../../scripts/regenerate.sh rewrites it.
        .target(name: "MeroChessGenerated"),
        .target(
            name: "ChessCore",
            dependencies: [
                "MeroChessGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
            ]
        ),
        .testTarget(
            name: "ChessCoreTests",
            dependencies: [
                "ChessCore",
                "MeroChessGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
