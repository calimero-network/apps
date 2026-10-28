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
        // swift-sdk `feat/app-session` (PR #84). Moves to the merge commit once it lands;
        // keep in step with `packages.MeroKit.revision` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "122bb0d71bb43b823cb9d694c4e70678a2ef8c89")
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
