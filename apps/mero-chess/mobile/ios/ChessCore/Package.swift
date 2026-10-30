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
        // The head of swift-sdk's Calimero 1.0 port (swift-sdk#85, feat/calimero-1.0); moves to its
        // merge commit once that lands. Keep it equal to the revision in ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "a1ec644130d4405a1bab7547654b1442cc559b49"),
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
