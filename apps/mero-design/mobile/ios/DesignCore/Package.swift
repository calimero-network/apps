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
        // swift-sdk `main`, the merge commit of PR #84. Keep it equal to ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "a1ec644130d4405a1bab7547654b1442cc559b49"),
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
