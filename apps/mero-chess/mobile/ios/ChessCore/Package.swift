// swift-tools-version: 5.9
// Hyperfeed Chess's non-UI layer: the typed contract client, the board helpers and the view models. A
// plain SwiftPM package so `swift build` / `swift test` run it on macOS with no simulator; the app
// (project.yml) links it as a local package.
import PackageDescription

let package = Package(
    name: "ChessCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "ChessCore", targets: ["ChessCore"]),
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release (Calimero 1.0); keep it equal to
        // ../project.yml.
        .package(url: "https://github.com/calimero-network/core", exact: "1.0.0-rc.38"),
    ],
    targets: [
        .target(
            name: "ChessCore",
            dependencies: [
                .product(name: "MeroKit", package: "core"),
            ]
        ),
        .testTarget(
            name: "ChessCoreTests",
            dependencies: [
                "ChessCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]
        ),
    ]
)
