// swift-tools-version: 5.9
//
// DesignCore: everything in the iOS app that is not a view. The generated
// contract client, the read-only scene builder (contract elements to drawable
// nodes), screens for Present, and the view models. It builds and tests on
// macOS with `swift test`, so none of it needs a simulator; project.yml links
// it into the app.
import PackageDescription

let package = Package(
    name: "DesignCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "DesignCore", targets: ["DesignCore"]),
    ],
    dependencies: [
        // swift-sdk `feat/app-session` (PR #84). Move to the merge commit once it lands.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "122bb0d71bb43b823cb9d694c4e70678a2ef8c89"),
    ],
    targets: [
        .target(
            name: "DesignCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "DesignCoreTests",
            dependencies: [
                "DesignCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
