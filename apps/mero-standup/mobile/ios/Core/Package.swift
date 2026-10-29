// swift-tools-version: 5.9
// StandupCore: everything in the iOS app that is not a view. The generated
// contract client, the pure helpers (days, carry-forward, digest, tags, rich
// text, invitations) and the view models, on MeroKit only, so `swift test`
// runs them on macOS without a simulator. project.yml links it into the app.
import PackageDescription

let package = Package(
    name: "StandupCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "StandupCore", targets: ["StandupCore"])
    ],
    dependencies: [
        // swift-sdk `main`, the merge commit of PR #84 (app session); keep it
        // equal to the revision in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f")
    ],
    targets: [
        .target(
            name: "StandupCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "StandupCoreTests",
            dependencies: [
                "StandupCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
