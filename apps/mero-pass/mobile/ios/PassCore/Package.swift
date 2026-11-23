// swift-tools-version: 5.9
// Hyperfeed Pass's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the vault crypto, the vault session, the
// generated contract client and the view models the SwiftUI screens bind.
//
// The MeroKit pin must match the one in ../project.yml (one revision for both).
import PackageDescription

let package = Package(
    name: "PassCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "PassCore", targets: ["PassCore", "PassGenerated"]),
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release (Calimero 1.0); keep it equal to
        // `exactVersion` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.35"),
    ],
    targets: [
        // Generated from ../../../logic/res/abi.json by core's meroctl app codegen
        // (scripts/mobile-codegen.sh at the repo root): one target per client, as codegen asks.
        .target(
            name: "PassGenerated",
            dependencies: [.product(name: "MeroKit", package: "core")]),
        .target(
            name: "PassCore",
            dependencies: [
                "PassGenerated",
                .product(name: "MeroKit", package: "core"),
            ]),
        .testTarget(
            name: "PassCoreTests",
            dependencies: [
                "PassCore",
                "PassGenerated",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]),
    ]
)
