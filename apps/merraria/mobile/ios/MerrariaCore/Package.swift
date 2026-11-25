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
        // MeroKit from a calimero-network/core release (Calimero 1.0). Keep it equal to the
        // exactVersion in ../project.yml.
        .package(url: "https://github.com/calimero-network/core", exact: "1.0.0-rc.37"),
    ],
    targets: [
        // Sources/MerrariaCore/Generated/MerrariaClient.swift is generated from the component ABI
        // (../../../logic/res/abi.json) by scripts/mobile-codegen.sh; ContractTests checks the
        // method lists in Contract/MerrariaContract.swift against it.
        .target(
            name: "MerrariaCore",
            dependencies: [.product(name: "MeroKit", package: "core")]
        ),
        .testTarget(
            name: "MerrariaCoreTests",
            dependencies: [
                "MerrariaCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]
        ),
    ]
)
