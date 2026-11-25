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
        // MeroKit from a calimero-network/core release (Calimero 1.0). Keep it equal to the
        // exactVersion in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.36")
    ],
    targets: [
        .target(
            name: "StandupCore",
            dependencies: [.product(name: "MeroKit", package: "core")]
        ),
        .testTarget(
            name: "StandupCoreTests",
            dependencies: [
                "StandupCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]
        ),
    ]
)
