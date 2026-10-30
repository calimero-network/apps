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
        // swift-sdk#85 (feat/calimero-1.0, Calimero 1.0) head; moves to its merge commit once it lands.
        // Keep it identical to ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "a1ec644130d4405a1bab7547654b1442cc559b49"),
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
