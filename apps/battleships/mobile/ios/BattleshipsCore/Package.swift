// swift-tools-version: 5.9
// Battleships' logic, outside the app target so it builds and tests on macOS with `swift test`
// (no simulator): the two generated contract clients, the board and its commit-reveal, the
// invitation codec and the view models the SwiftUI screens bind.
//
// The swift-sdk pin must match the one in ../project.yml (one revision for both).
import PackageDescription

let package = Package(
    name: "BattleshipsCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "BattleshipsCore", targets: ["BattleshipsCore", "LobbyGenerated", "GameGenerated"]),
    ],
    dependencies: [
        // swift-sdk `main`, the merge commit of swift-sdk#84. Keep it identical to ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f"),
    ],
    targets: [
        // `scripts/codegen.sh`: one module per service. Each generated file declares its own
        // `ContextContractCalling`, which would collide with the other's (and shadow MeroKit's)
        // in one module.
        .target(name: "LobbyGenerated"),
        .target(name: "GameGenerated"),
        .target(
            name: "BattleshipsCore",
            dependencies: [
                "LobbyGenerated",
                "GameGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
            ]),
        .testTarget(
            name: "BattleshipsCoreTests",
            dependencies: [
                "BattleshipsCore",
                "LobbyGenerated",
                "GameGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]),
    ]
)
