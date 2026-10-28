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
        // feat/app-session (swift-sdk#84). Moves to the merge commit once that PR lands; keep it
        // equal to the revision in ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "122bb0d71bb43b823cb9d694c4e70678a2ef8c89"),
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
