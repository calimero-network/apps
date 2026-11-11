// swift-tools-version: 5.9
// Mero Kombat's non-UI layer: the typed contract client, the arena and lobby view models, the
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
        // swift-sdk release v0.5.0 (Calimero 1.0); keep it equal to ../project.yml.
        // Unreleased swift-sdk 1.0 (calimero-network/swift-sdk#91): back to exact: once 1.0.0 is tagged.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "dfc8082102130d03920e096feca6b559555a530d"),
    ],
    targets: [
        // Sources/KombatCore/Contract/KombatClient.swift is typed by hand from the component ABI
        // (../../../logic/res/abi.json); ContractTests checks its method lists against it.
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
