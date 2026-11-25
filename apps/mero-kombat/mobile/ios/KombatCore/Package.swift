// swift-tools-version: 5.9
// Hyperfeed Kombat's non-UI layer: the typed contract client, the arena and lobby view models, the
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
        // MeroKit from a calimero-network/core release (Calimero 1.0); keep it equal to
        // ../project.yml.
        .package(url: "https://github.com/calimero-network/core", exact: "1.0.0-rc.36"),
    ],
    targets: [
        // Sources/KombatCore/Generated/KombatClient.swift is generated from the component ABI
        // (../../../logic/res/abi.json) by scripts/mobile-codegen.sh; ContractTests checks the
        // method lists in Contract/KombatContract.swift against it.
        .target(
            name: "KombatCore",
            dependencies: [.product(name: "MeroKit", package: "core")]
        ),
        .testTarget(
            name: "KombatCoreTests",
            dependencies: [
                "KombatCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]
        ),
    ]
)
