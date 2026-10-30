// swift-tools-version: 5.9
// StreamCore: everything in the iOS app that is not a view or a camera. The
// generated contract client, the web app's media framing (byte for byte), the
// broadcaster slots, G.711 audio, the H.264 Annex-B helpers and the view
// models, on MeroKit only, so `swift test` runs them on macOS without a
// simulator. project.yml links it into the app.
import PackageDescription

let package = Package(
    name: "StreamCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "StreamCore", targets: ["StreamCore"])
    ],
    dependencies: [
        // The head of swift-sdk's Calimero 1.0 branch (PR #85); moves to its
        // merge commit once it lands. Keep it equal to the revision in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "6c5f1167d1e586f556f59c326de5f51d034e80dd")
    ],
    targets: [
        .target(
            name: "StreamCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "StreamCoreTests",
            dependencies: [
                "StreamCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ],
            resources: [.copy("Fixtures")]
        ),
    ]
)
