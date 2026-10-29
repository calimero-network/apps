// swift-tools-version: 5.9
// The issue tracker's non-UI layer: the generated contract client, the models
// behind every screen, and their tests. A SwiftPM package so `swift test` runs
// it on macOS with no simulator; project.yml links it into the iOS app.
import PackageDescription

let package = Package(
    name: "IssueTrackerCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "IssueTrackerCore", targets: ["IssueTrackerCore"])
    ],
    dependencies: [
        // swift-sdk `main`, the merge commit of PR #84 (app session);
        // keep in step with `packages.MeroKit.revision` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f")
    ],
    targets: [
        .target(
            name: "IssueTrackerCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "IssueTrackerCoreTests",
            dependencies: [
                "IssueTrackerCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
