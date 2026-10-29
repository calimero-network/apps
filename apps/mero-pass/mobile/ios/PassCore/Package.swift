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
        // The main merge commit of swift-sdk#84.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f"),
    ],
    targets: [
        // `node abi-codegen -i ../../logic/res/abi.json --target swift --client-name PassClient`.
        // Its own module: it declares its own `ContextContractCalling`, which
        // would shadow MeroKit's in a module that imports both.
        .target(name: "PassGenerated"),
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
