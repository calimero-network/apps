// swift-tools-version: 5.9
// Mero Pass's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the vault crypto, the vault session, the
// generated contract client and the view models the SwiftUI screens bind.
//
// The swift-sdk pin must match the one in ../project.yml (one revision for both).
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
        // swift-sdk v4.1.0 (Calimero 1.0); keep it equal to `exactVersion` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            exact: "4.1.0"),
    ],
    targets: [
        // Generated from ../../../logic/res/abi.json by core's mero-app-build codegen
        // (scripts/mobile-codegen.sh at the repo root): one target per client, as codegen asks.
        .target(
            name: "PassGenerated",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]),
        .target(
            name: "PassCore",
            dependencies: [
                "PassGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
            ]),
        .testTarget(
            name: "PassCoreTests",
            dependencies: [
                "PassCore",
                "PassGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]),
    ]
)
