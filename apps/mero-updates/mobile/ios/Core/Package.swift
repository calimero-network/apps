// swift-tools-version: 5.9
// UpdatesCore: everything in the iOS app that is not a view. The generated
// contract client, the pure helpers (formatting, KPI deltas, templates and the
// composer, invitations) and the view models, on MeroKit only, so `swift test`
// runs them on macOS without a simulator. project.yml links it into the app.
import PackageDescription

let package = Package(
    name: "UpdatesCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "UpdatesCore", targets: ["UpdatesCore"])
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
            name: "UpdatesCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "UpdatesCoreTests",
            dependencies: [
                "UpdatesCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
