// swift-tools-version: 5.9
// Merraria's non-UI layer: the typed contract client, the world list, invitations, the
// JS bridge to the bundled game and the touch-control mapping. A plain SwiftPM package so
// `swift build` / `swift test` run it on macOS with no simulator; the app (project.yml) links it
// as a local package.
import PackageDescription

let package = Package(
    name: "MerrariaCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "MerrariaCore", targets: ["MerrariaCore"]),
    ],
    dependencies: [
        // swift-sdk v0.7.0 (Calimero 1.0). Keep it equal to the exactVersion
        // in ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", exact: "0.7.0"),
    ],
    targets: [
        // Sources/MerrariaCore/Contract/MerrariaClient.swift is typed by hand from the component ABI
        // (../../../logic/res/abi.json); ContractTests checks its method lists against it.
        .target(
            name: "MerrariaCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "MerrariaCoreTests",
            dependencies: [
                "MerrariaCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
