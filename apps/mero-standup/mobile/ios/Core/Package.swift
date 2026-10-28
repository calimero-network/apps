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
        // swift-sdk `feat/app-session` (PR #84). Moves to the merge commit once
        // that PR lands; keep it equal to the revision in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "122bb0d71bb43b823cb9d694c4e70678a2ef8c89")
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
