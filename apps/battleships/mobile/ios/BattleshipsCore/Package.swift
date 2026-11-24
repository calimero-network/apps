// swift-tools-version: 5.9
// Battleships' logic, outside the app target so it builds and tests on macOS with `swift test`
// (no simulator): the typed contract client, the board and its commit-reveal, the invitation
// codec and the view models the SwiftUI screens bind.
//
// The MeroKit pin must match the one in ../project.yml (one version for both).
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
        // MeroKit from a calimero-network/core release (Calimero 1.0). Keep it identical to
        // ../project.yml.
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.36"),
    ],
    targets: [
        .target(
            name: "BattleshipsCore",
            dependencies: [
                .product(name: "MeroKit", package: "core"),
            ]),
        .testTarget(
            name: "BattleshipsCoreTests",
            dependencies: [
                "BattleshipsCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]),
    ]
)
