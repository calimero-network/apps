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
        // swift-sdk#85 (feat/calimero-1.0, Calimero 1.0) head; moves to its merge commit once it lands.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "6c5f1167d1e586f556f59c326de5f51d034e80dd"),
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
