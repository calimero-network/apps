// swift-tools-version: 5.9
// Mero Kombat's non-UI layer: the generated contract client, the arena and lobby view models, the
// JS bridge to the game page, the fight pad's input mapping and the presence channel. A plain
// SwiftPM package so `swift build` / `swift test` run it on macOS with no simulator; the app
// (project.yml) links it as a local package.
import PackageDescription

let package = Package(
    name: "KombatCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "KombatCore", targets: ["KombatCore"]),
    ],
    dependencies: [
        // feat/app-session (swift-sdk#84). Moves to the merge commit once that PR lands; keep it
        // equal to the revision in ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "551fc784e7545bcdbf358b4c348e6cd381b4512f"),
    ],
    targets: [
        // Sources/KombatCore/Generated/KombatClient.swift is generated from ../../../logic/res/abi.json
        // by @calimero-network/abi-codegen with --transport-import MeroKit. Never edit it by hand:
        // ../../scripts/regenerate.sh rewrites it.
        .target(
            name: "KombatCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "KombatCoreTests",
            dependencies: [
                "KombatCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
