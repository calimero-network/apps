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
        // MeroKit from a calimero-network/core release (Calimero 1.0). Keep it equal to the
        // exactVersion in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.38")
    ],
    targets: [
        .target(
            name: "UpdatesCore",
            dependencies: [.product(name: "MeroKit", package: "core")]
        ),
        .testTarget(
            name: "UpdatesCoreTests",
            dependencies: [
                "UpdatesCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]
        ),
    ]
)
