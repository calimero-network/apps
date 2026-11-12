// swift-tools-version: 5.9
// Mero Chess's non-UI layer: the typed contract client, the board helpers and the view models. A
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
        // swift-sdk release v2.0.0 (Calimero 1.0); keep it equal to ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", exact: "2.0.0"),
    ],
    targets: [
        .target(
            name: "ChessCore",
            dependencies: [
                .product(name: "MeroKit", package: "swift-sdk"),
            ]
        ),
        .testTarget(
            name: "ChessCoreTests",
            dependencies: [
                "ChessCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
