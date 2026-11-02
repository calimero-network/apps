// swift-tools-version: 5.9
// Battleships' logic, outside the app target so it builds and tests on macOS with `swift test`
// (no simulator): the typed contract client, the board and its commit-reveal, the invitation
// codec and the view models the SwiftUI screens bind.
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
        .library(name: "BattleshipsCore", targets: ["BattleshipsCore"]),
    ],
    dependencies: [
        // swift-sdk#85 (feat/calimero-1.0, Calimero 1.0) head; moves to its merge commit once it lands.
        // Keep it identical to ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "37c09f3f96e7d98440f6618eef8a0e83ddee8ebd"),
    ],
    targets: [
        .target(
            name: "BattleshipsCore",
            dependencies: [
                .product(name: "MeroKit", package: "swift-sdk"),
            ]),
        .testTarget(
            name: "BattleshipsCoreTests",
            dependencies: [
                "BattleshipsCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]),
    ]
)
