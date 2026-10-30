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
        // swift-sdk#85 (feat/calimero-1.0, Calimero 1.0) head; moves to its merge commit once it lands.
        // Keep it equal to the revision in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "6c5f1167d1e586f556f59c326de5f51d034e80dd")
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
